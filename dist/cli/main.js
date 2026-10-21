#!/usr/bin/env node
// The `protocol` command.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { evaluate } from "../evaluator/evaluate.js";
import { createClient, GitHubError } from "../github/api.js";
import { defaultBranch, openPulls, pullForBranch, readBranchRules, readPullRequest } from "../github/read.js";
import { actorsOf, ansi, clean, describeRequirement, plain, renderEvaluation, verdictWord } from "./render.js";
import { realGit, resolvePullTarget, resolveRepo, TargetError } from "./target.js";
// Exit codes follow the verdict, so scripts and CI can use `protocol check` directly.
export const EXIT = { ready: 0, blocked: 1, pending: 2, unknown: 3 };
export const EXIT_USAGE = 64;
export const HELP = `protocol - explain why a pull request can or cannot be merged, and who has to act

Usage:
  protocol check [<pull-request>] [options]   evaluate one pull request
  protocol rules [<branch>] [options]         show what a branch requires before merging
  protocol list [options]                     every open pull request with its verdict

<pull-request> can be:
  1418                                  number, in the repository of the current directory
  owner/repo#1418                       any repository
  https://github.com/owner/repo/pull/1418
  (nothing)                             the open pull request of the current branch

Options:
  -R, --repo <owner/repo>   use this repository instead of the current directory's
  -j, --json                print machine-readable JSON
  -q, --quiet               print nothing; the exit code is the verdict
  -n, --limit <n>           how many pull requests 'list' evaluates (default 10)
      --no-color            plain output (also when NO_COLOR is set)
  -h, --help                show this help
  -V, --version             show the version

Environment:
  GITHUB_TOKEN   for private repositories and a higher rate limit
                 with the GitHub CLI: export GITHUB_TOKEN=$(gh auth token)

Exit status of 'check':
  0 ready   1 blocked   2 waiting   3 unknown or error   64 usage error

protocol only reads from GitHub. It never comments, approves or merges.`;
function version() {
    const pkg = join(dirname(realpathSync(import.meta.filename)), "..", "..", "package.json");
    return JSON.parse(readFileSync(pkg, "utf8")).version;
}
export async function run(argv, io) {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                repo: { type: "string", short: "R" },
                json: { type: "boolean", short: "j" },
                quiet: { type: "boolean", short: "q" },
                limit: { type: "string", short: "n" },
                "no-color": { type: "boolean" },
                help: { type: "boolean", short: "h" },
                version: { type: "boolean", short: "V" },
            },
        });
    }
    catch (err) {
        io.err(`protocol: ${err.message}\nTry 'protocol --help'.`);
        return EXIT_USAGE;
    }
    const { values: opt, positionals } = parsed;
    const [command, arg, ...extra] = positionals;
    if (opt.version) {
        io.out(`protocol ${version()}`);
        return 0;
    }
    if (opt.help || !command || command === "help") {
        (command && command !== "help" ? io.err : io.out)(HELP);
        return opt.help || command === "help" ? 0 : EXIT_USAGE;
    }
    if (extra.length > 0 || !["check", "rules", "list"].includes(command) || (command === "list" && arg)) {
        io.err(`protocol: unexpected '${extra[0] ?? (command === "list" ? arg : command)}'\nTry 'protocol --help'.`);
        return EXIT_USAGE;
    }
    const paint = io.isTty && !opt["no-color"] && !io.env.NO_COLOR ? ansi : plain;
    const gh = io.client ?? createClient(io.env.GITHUB_TOKEN);
    const say = (s) => {
        if (!opt.quiet)
            io.out(s);
    };
    try {
        if (command === "check") {
            const target = resolvePullTarget(arg, opt.repo, io.git);
            let ref;
            if (target.kind === "pull")
                ref = target.ref;
            else {
                const n = await pullForBranch(gh, target.repo.owner, target.repo.repo, target.branch);
                if (n === null) {
                    io.err(`protocol: no open pull request for branch '${target.branch}' in ${target.repo.owner}/${target.repo.repo}.`);
                    return EXIT.unknown;
                }
                ref = { ...target.repo, number: n };
            }
            const evaluation = evaluate(await readPullRequest(gh, ref));
            say(opt.json ? JSON.stringify(evaluation, null, 2) : renderEvaluation(evaluation, `${ref.owner}/${ref.repo}#${ref.number}`, paint));
            return EXIT[evaluation.verdict];
        }
        const repo = resolveRepo(opt.repo, io.git);
        if (command === "rules") {
            const branch = arg ?? (await defaultBranch(gh, repo.owner, repo.repo));
            const rules = await readBranchRules(gh, repo.owner, repo.repo, branch);
            if (opt.json) {
                say(JSON.stringify({ branch, ...rules }, null, 2));
            }
            else {
                const lines = [paint(1, `${repo.owner}/${repo.repo}: ${clean(branch)}`), ""];
                if (rules.requirements.length === 0)
                    lines.push("No required checks or reviews that are visible to you.");
                lines.push(...rules.requirements.map((r) => `• ${describeRequirement(r)}`));
                lines.push(...rules.missingData.map((m) => paint(33, `could not read: ${m}`)));
                lines.push(...rules.notes.map((n) => paint(90, `note: ${n}`)));
                say(lines.join("\n"));
            }
            return rules.missingData.length > 0 ? EXIT.unknown : 0;
        }
        // list
        const limit = opt.limit === undefined ? 10 : Number(opt.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
            io.err("protocol: --limit must be a whole number from 1 to 50.");
            return EXIT_USAGE;
        }
        if (!io.env.GITHUB_TOKEN)
            io.err(paint(90, "note: without GITHUB_TOKEN GitHub allows 60 requests per hour; 'list' may run out."));
        const pulls = await openPulls(gh, repo.owner, repo.repo, limit);
        if (pulls.length === 0) {
            say(`No open pull requests in ${repo.owner}/${repo.repo}.`);
            return 0;
        }
        const rows = [];
        for (const p of pulls.slice(0, limit)) {
            const e = evaluate(await readPullRequest(gh, { ...repo, number: p.number }));
            rows.push({ number: p.number, title: p.title, verdict: e.verdict, actors: actorsOf(e) });
            if (!opt.json)
                say(`#${String(p.number).padEnd(6)} ${verdictWord(e.verdict, paint)}  ${actorsOf(e).padEnd(18)} ${clean(p.title).slice(0, 60)}`);
        }
        if (opt.json)
            say(JSON.stringify(rows, null, 2));
        return 0;
    }
    catch (err) {
        if (err instanceof TargetError || err instanceof GitHubError) {
            io.err(`protocol: ${err.message}`);
            return err instanceof TargetError ? EXIT_USAGE : EXIT.unknown;
        }
        throw err;
    }
}
// Run only when executed as the program, not when imported by the tests.
const invoked = process.argv[1] ? realpathSync(resolve(process.argv[1])) : "";
if (invoked === realpathSync(import.meta.filename)) {
    process.exitCode = await run(process.argv.slice(2), {
        out: (s) => console.log(s),
        err: (s) => console.error(s),
        env: process.env,
        isTty: process.stdout.isTTY === true,
        git: realGit,
    });
}
