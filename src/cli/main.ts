#!/usr/bin/env node
// The `protocol` command.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { evaluate } from "../evaluator/evaluate.ts";
import type { Evaluation, Verdict } from "../evaluator/types.ts";
import { createClient, GitHubError, type GitHubClient } from "../github/api.ts";
import { defaultBranch, openPulls, pullForBranch, readBranchRules, readPullRequest, viewerLogin } from "../github/read.ts";
import {
  actorsOf,
  ansi,
  clean,
  describeRequirement,
  formatList,
  markdownEvaluation,
  markdownList,
  plain,
  renderEvaluation,
  waitsOn,
  type ListRow,
  type Paint,
} from "./render.ts";
import { noSpinner, startSpinner, type Spinner } from "./spinner.ts";
import { realGit, resolvePullTarget, resolveRepo, TargetError, type Git } from "./target.ts";

// Exit codes follow the verdict, so scripts and CI can use `protocol check` directly.
export const EXIT: Record<Verdict, number> = { ready: 0, blocked: 1, pending: 2, unknown: 3 };
export const EXIT_USAGE = 64;

const DEFAULT_INTERVAL_S = 30;
const MIN_INTERVAL_S = 5;
// Pull requests 'list' reads at the same time: faster, and well under GitHub's secondary limits.
const LIST_CONCURRENCY = 4;

export const HELP = `protocol - explain why a pull request can or cannot be merged, and who has to act

Usage:
  prot check [<pull-request>] [options]   evaluate one pull request
  prot rules [<branch>] [options]         show what a branch requires before merging
  prot list [options]                     every open pull request with its verdict
  prot list --me                          only the pull requests waiting on you

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
  -m, --markdown            print Markdown, for a CI job summary or a comment
  -w, --watch               'check': look again until the verdict is no longer waiting,
                            printing each change; the exit code is the final verdict
      --interval <seconds>  time between looks with --watch (default 30, minimum 5)
      --me                  'list': only pull requests where you have something to do
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
  /** Waits between looks in --watch; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
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
        markdown: { type: "boolean", short: "m" },
        watch: { type: "boolean", short: "w" },
        interval: { type: "string" },
        me: { type: "boolean" },
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

  const wrong =
    opt.json && opt.markdown
      ? "--json and --markdown cannot be used together."
      : opt.watch && command !== "check"
        ? "--watch only works with 'check'."
        : opt.interval !== undefined && !opt.watch
          ? "--interval only works with --watch."
          : opt.me && command !== "list"
            ? "--me only works with 'list'."
            : null;
  if (wrong) {
    io.err(`prot: ${wrong}\nTry 'prot --help'.`);
    return EXIT_USAGE;
  }
  const interval = opt.interval === undefined ? DEFAULT_INTERVAL_S : Number(opt.interval);
  if (!Number.isInteger(interval) || interval < MIN_INTERVAL_S || interval > 3600) {
    io.err(`prot: --interval must be a whole number of seconds from ${MIN_INTERVAL_S} to 3600.`);
    return EXIT_USAGE;
  }
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = io.now ?? (() => new Date());

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
      const show = (e: Evaluation, compact: boolean) =>
        opt.json
          ? JSON.stringify(e, null, compact ? undefined : 2)
          : opt.markdown
            ? markdownEvaluation(e, ref)
            : renderEvaluation(e, `${ref.owner}/${ref.repo}#${ref.number}`, paint);
      let evaluation = evaluate(await readPullRequest(gh, ref));
      if (!opt.watch) {
        say(show(evaluation, false));
        return EXIT[evaluation.verdict];
      }

      // --watch prints the first evaluation, then only what changed (one JSON object per line
      // with --json), and stops as soon as the verdict is no longer "waiting".
      let shown = "";
      for (;;) {
        const seen = signature(evaluation);
        if (seen !== shown) {
          const stamp = shown === "" || opt.json || opt.markdown ? "" : `\n${paint(90, `[${now().toTimeString().slice(0, 8)}]`)} `;
          say(stamp + show(evaluation, true));
          shown = seen;
        }
        if (evaluation.verdict !== "pending") return EXIT[evaluation.verdict];
        working(`Waiting for ${ref.owner}/${ref.repo}#${ref.number}: next look in ${interval}s (Ctrl+C to stop)…`);
        await sleep(interval * 1000);
        working(`Checking ${ref.owner}/${ref.repo}#${ref.number}…`);
        evaluation = evaluate(await readPullRequest(gh, ref));
      }
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
    if (opt.me && !io.client && !token) {
      io.err("prot: --me needs to know who you are: log in with 'gh auth login' or set GITHUB_TOKEN.");
      return EXIT.unknown;
    }
    if (!io.client && !token) io.err(paint(90, "note: not logged in to GitHub (no GITHUB_TOKEN, no gh session): 60 requests per hour; 'list' may run out."));
    working(`Listing open pull requests in ${repo.owner}/${repo.repo}…`);
    const pulls = await openPulls(gh, repo.owner, repo.repo, limit);
    if (pulls.length === 0) {
      say(`No open pull requests in ${repo.owner}/${repo.repo}.`);
      return 0;
    }
    const me = opt.me ? await viewerLogin(gh) : null;
    const todo = pulls.slice(0, limit);
    let finished = 0;
    working(`Checking pull requests 0/${todo.length}…`);
    const evaluations = await mapLimit(todo, LIST_CONCURRENCY, async (p) => {
      const e = evaluate(await readPullRequest(gh, { ...repo, number: p.number }));
      working(`Checking pull requests ${++finished}/${todo.length}…`);
      return e;
    });
    const rows: ListRow[] = [];
    for (const [i, p] of todo.entries()) {
      const e = evaluations[i] as Evaluation;
      const pull = { author: p.user?.login ?? "", requestedReviewers: (p.requested_reviewers ?? []).map((u) => u.login) };
      if (me && !waitsOn(e, me, pull)) continue;
      rows.push({ number: p.number, title: p.title, verdict: e.verdict, actors: actorsOf(e) });
    }
    if (rows.length === 0) {
      say(`Nothing is waiting on ${clean(me ?? "")} in ${repo.owner}/${repo.repo}.`);
      return 0;
    }
    say(opt.json ? JSON.stringify(rows, null, 2) : opt.markdown ? markdownList(rows, repo) : formatList(rows, paint, io.columns));
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

/** Runs `fn` over `items`, at most `limit` at a time; results keep the order of `items`. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** What --watch compares: a new line is printed only when one of these changes. */
function signature(e: Evaluation): string {
  return [e.verdict, e.headSha, ...e.results.map((r) => `${r.id}=${r.status}`)].join(" ");
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
