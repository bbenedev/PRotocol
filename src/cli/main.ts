#!/usr/bin/env node
// The `protocol` command.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { evaluate } from "../evaluator/evaluate.ts";
import type { Verdict } from "../evaluator/types.ts";
import { createClient, GitHubError, type GitHubClient } from "../github/api.ts";
import { defaultBranch, openPulls, pullForBranch, readBranchRules, readPullRequest } from "../github/read.ts";
import { actorsOf, ansi, clean, describeRequirement, formatList, plain, renderEvaluation, type ListRow, type Paint } from "./render.ts";
import { noSpinner, startSpinner, type Spinner } from "./spinner.ts";
import { realGit, resolvePullTarget, resolveRepo, TargetError, type Git } from "./target.ts";

// Exit codes follow the verdict, so scripts and CI can use `protocol check` directly.
export const EXIT: Record<Verdict, number> = { ready: 0, blocked: 1, pending: 2, unknown: 3 };
export const EXIT_USAGE = 64;

export const HELP = `protocol - explain why a pull request can or cannot be merged, and who has to act

Usage:
  prot check [<pull-request>] [options]   evaluate one pull request
  prot rules [<branch>] [options]         show what a branch requires before merging
  prot list [options]                     every open pull request with its verdict

  'prot' is the short name; 'protocol' runs the same command.

<pull-request> can be:
  1418                                  number, in the repository of the current directory
  owner/repo#1418                       any repository
  https://github.com/owner/repo/pull/1418
  (nothing)                             the open pull request of the current branch

Options:
  -r, --repo <owner/repo>   use this repository instead of the current directory's
                            (-R also works, as in gh)
  -j, --json                print machine-readable JSON
  -q, --quiet               print nothing; the exit code is the verdict
  -n, --limit <n>           how many pull requests 'list' evaluates (default 10)
      --no-color            plain output (also when NO_COLOR is set)
  -h, --help                show this help
  -V, --version             show the version

Authentication (first one found):
  GITHUB_TOKEN or GH_TOKEN    environment variable
  gh auth token               the GitHub CLI session, if gh is installed and logged in
  (none)                      public repositories only, 60 requests per hour

Exit status of 'check':
  0 ready   1 blocked   2 waiting   3 unknown or error   64 usage error

protocol only reads from GitHub. It never comments, approves or merges.`;

interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  env: Record<string, string | undefined>;
  isTty: boolean;
  /** Terminal width, when known; long titles are cut to fit instead of wrapping. */
  columns?: number | undefined;
  git: Git;
  /** Token from the GitHub CLI session, or null when gh is missing or logged out. */
  ghToken: () => string | null;
  /** Starts a progress indicator; absent when stderr is not an interactive terminal. */
  progress?: ((text: string) => Spinner) | undefined;
  client?: GitHubClient;
}

export function findToken(env: Record<string, string | undefined>, ghToken: () => string | null): string | undefined {
  return env.GITHUB_TOKEN || env.GH_TOKEN || ghToken() || undefined;
}

export const realGhToken = (): string | null => {
  try {
    // The token never leaves this process except in the Authorization header to api.github.com.
    const t = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
    return t || null;
  } catch {
    return null;
  }
};

function version(): string {
  const pkg = join(dirname(realpathSync(import.meta.filename)), "..", "..", "package.json");
  return (JSON.parse(readFileSync(pkg, "utf8")) as { version: string }).version;
}

export async function run(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      // -R is accepted too, because that is the flag gh uses for the same thing.
      args: argv.map((a) => (a.startsWith("-R") ? `-r${a.slice(2)}` : a)),
      allowPositionals: true,
      options: {
        repo: { type: "string", short: "r" },
        json: { type: "boolean", short: "j" },
        quiet: { type: "boolean", short: "q" },
        limit: { type: "string", short: "n" },
        "no-color": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "V" },
      },
    });
  } catch (err) {
    io.err(`prot: ${(err as Error).message}\nTry 'prot --help'.`);
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
    io.err(`prot: unexpected '${extra[0] ?? (command === "list" ? arg : command)}'\nTry 'prot --help'.`);
    return EXIT_USAGE;
  }

  const paint: Paint = io.isTty && !opt["no-color"] && !io.env.NO_COLOR ? ansi : plain;
  const token = io.client ? undefined : findToken(io.env, io.ghToken);
  const gh = io.client ?? createClient(token);
  let spin: Spinner = noSpinner;
  const working = (text: string) => {
    if (spin !== noSpinner) spin.update(text);
    else if (!opt.quiet && !opt.json && io.progress) spin = io.progress(text);
  };
  const done = () => {
    spin.stop();
    spin = noSpinner;
  };
  const say = (s: string) => {
    done();
    if (!opt.quiet) io.out(s);
  };

  try {
    if (command === "check") {
      const target = resolvePullTarget(arg, opt.repo, io.git);
      working(target.kind === "pull" ? `Checking ${target.ref.owner}/${target.ref.repo}#${target.ref.number}…` : `Looking for the pull request of '${target.branch}'…`);
      let ref;
      if (target.kind === "pull") ref = target.ref;
      else {
        const n = await pullForBranch(gh, target.repo.owner, target.repo.repo, target.branch);
        if (n === null) {
          done();
          io.err(`prot: no open pull request for branch '${target.branch}' in ${target.repo.owner}/${target.repo.repo}.`);
          return EXIT.unknown;
        }
        ref = { ...target.repo, number: n };
        working(`Checking ${ref.owner}/${ref.repo}#${ref.number}…`);
      }
      const evaluation = evaluate(await readPullRequest(gh, ref));
      say(opt.json ? JSON.stringify(evaluation, null, 2) : renderEvaluation(evaluation, `${ref.owner}/${ref.repo}#${ref.number}`, paint));
      return EXIT[evaluation.verdict];
    }

    const repo = resolveRepo(opt.repo, io.git);

    if (command === "rules") {
      working(`Reading the rules of ${repo.owner}/${repo.repo}…`);
      const branch = arg ?? (await defaultBranch(gh, repo.owner, repo.repo));
      const rules = await readBranchRules(gh, repo.owner, repo.repo, branch);
      if (opt.json) {
        say(JSON.stringify({ branch, ...rules }, null, 2));
      } else {
        const lines = [paint(1, `${repo.owner}/${repo.repo}: ${clean(branch)}`), ""];
        if (rules.requirements.length === 0) lines.push("No required checks or reviews that are visible to you.");
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
      io.err("prot: --limit must be a whole number from 1 to 50.");
      return EXIT_USAGE;
    }
    if (!io.client && !token) io.err(paint(90, "note: not logged in to GitHub (no GITHUB_TOKEN, no gh session): 60 requests per hour; 'list' may run out."));
    working(`Listing open pull requests in ${repo.owner}/${repo.repo}…`);
    const pulls = await openPulls(gh, repo.owner, repo.repo, limit);
    if (pulls.length === 0) {
      say(`No open pull requests in ${repo.owner}/${repo.repo}.`);
      return 0;
    }
    const rows: ListRow[] = [];
    const todo = pulls.slice(0, limit);
    for (const [i, p] of todo.entries()) {
      working(`Checking pull requests ${i + 1}/${todo.length}…`);
      const e = evaluate(await readPullRequest(gh, { ...repo, number: p.number }));
      rows.push({ number: p.number, title: p.title, verdict: e.verdict, actors: actorsOf(e) });
    }
    say(opt.json ? JSON.stringify(rows, null, 2) : formatList(rows, paint, io.columns));
    return 0;
  } catch (err) {
    done();
    if (err instanceof TargetError || err instanceof GitHubError) {
      io.err(`prot: ${err.message}`);
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
    columns: process.stdout.columns,
    git: realGit,
    ghToken: realGhToken,
    progress: process.stderr.isTTY ? (text) => startSpinner((s) => process.stderr.write(s), text) : undefined,
  });
}
