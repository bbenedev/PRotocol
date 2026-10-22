import assert from "node:assert/strict";
import { test } from "node:test";
import { EXIT, EXIT_USAGE, findToken, run } from "../../src/cli/main.ts";
import { clean, formatList, plain } from "../../src/cli/render.ts";
import { startSpinner, type Spinner } from "../../src/cli/spinner.ts";
import { repoFromRemote, resolvePullTarget, type Git } from "../../src/cli/target.ts";
import type { GitHubClient } from "../../src/github/api.ts";

const HEAD = "a".repeat(40);
const BASE = "c".repeat(40);

const gitIn = (remote: string | null, branch = "feature"): Git => (args) =>
  args[0] === "remote" ? remote : args[0] === "rev-parse" ? branch : null;

test("github remotes in every common form", () => {
  for (const url of [
    "https://github.com/acme/app.git",
    "https://github.com/acme/app",
    "git@github.com:acme/app.git",
    "ssh://git@github.com/acme/app.git",
  ]) {
    assert.deepEqual(repoFromRemote(url), { owner: "acme", repo: "app" }, url);
  }
  assert.equal(repoFromRemote("https://gitlab.com/acme/app.git"), null);
});

test("a bare number uses the repository of the current directory", () => {
  assert.deepEqual(resolvePullTarget("#12", undefined, gitIn("git@github.com:acme/app.git")), {
    kind: "pull",
    ref: { owner: "acme", repo: "app", number: 12 },
  });
});

test("--repo wins over the current directory", () => {
  const t = resolvePullTarget("12", "other/thing", gitIn("git@github.com:acme/app.git"));
  assert.deepEqual(t, { kind: "pull", ref: { owner: "other", repo: "thing", number: 12 } });
});

test("no argument means the pull request of the current branch", () => {
  assert.deepEqual(resolvePullTarget(undefined, undefined, gitIn("https://github.com/acme/app", "fix-login")), {
    kind: "branch",
    repo: { owner: "acme", repo: "app" },
    branch: "fix-login",
  });
});

test("outside a repository a bare number is a clear error", () => {
  assert.throws(() => resolvePullTarget("12", undefined, gitIn(null)), /--repo owner\/repo/);
});

test("list lines fit the terminal: tight columns and long titles cut with an ellipsis", () => {
  const rows = [
    { number: 3, title: "Stale: green on an older commit", verdict: "pending" as const, actors: "ci" },
    { number: 12, title: "Passing", verdict: "ready" as const, actors: "—" },
  ];
  const lines = formatList(rows, plain, 40).split("\n");
  assert.equal(lines[0], "#3   WAITING  ci  Stale: green on an o…");
  assert.equal(lines[1], "#12  READY    —   Passing");
  assert.ok(lines.every((l) => l.length < 40));
  assert.ok(formatList(rows, plain).includes("older commit"), "no width known: nothing is cut");
});

test("terminal output cannot carry escape sequences from repository text", () => {
  assert.equal(clean("ok\u001b[2Jbad"), "ok [2Jbad");
});

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
}

function client(checkConclusion: string, viewer = "ana"): GitHubClient {
  const routes: [string, unknown][] = [
    ["/repos/acme/app/pulls/7/commits", [{ sha: HEAD }]],
    ["/repos/acme/app/pulls/7/reviews", []],
    ["/repos/acme/app/pulls/7", { state: "open", draft: false, mergeable: true, user: { login: "ana" }, head: { sha: HEAD }, base: { ref: "main", sha: BASE } }],
    ["/repos/acme/app/pulls?state=open&head=", [{ number: 7 }]],
    ["/repos/acme/app/pulls?state=open&sort=", [{ number: 7, title: "Fix login", user: { login: "ana" }, requested_reviewers: [{ login: "bob" }] }]],
    ["/user", { login: viewer }],
    ["/repos/acme/app/branches/main", { protected: false }],
    ["/repos/acme/app/rules/branches/main", [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "test" }] } }]],
    [`/repos/acme/app/commits/${HEAD}/check-runs`, { check_runs: [{ id: 1, name: "test", head_sha: HEAD, status: checkConclusion === "in_progress" ? "in_progress" : "completed", conclusion: checkConclusion === "in_progress" ? null : checkConclusion, started_at: "2026-10-21T10:00:00Z", html_url: null, app: null }] }],
    [`/repos/acme/app/commits/${HEAD}/statuses`, []],
  ];
  const find = (p: string) => routes.find(([k]) => p.startsWith(k))?.[1];
  return {
    get: async <T>(p: string) => {
      const v = find(p);
      if (v === undefined) throw new Error(`unexpected ${p}`);
      return v as T;
    },
    tryGet: async <T>(p: string) => (find(p) ?? null) as T | null,
  };
}

const io = (c: ReturnType<typeof capture>, gh: GitHubClient, git: Git = gitIn("git@github.com:acme/app.git")) => ({
  ...c.io,
  env: {},
  isTty: false,
  git,
  ghToken: () => null,
  client: gh,
});

test("-r chooses the repository, and -R works too, as in gh", async () => {
  const noRepo = gitIn(null);
  for (const flag of ["-r", "-R"]) {
    const c = capture();
    assert.equal(await run(["check", flag, "acme/app", "7"], io(c, client("success"), noRepo)), EXIT.ready, flag);
  }
  assert.equal(await run(["check", "-Racme/app", "7"], io(capture(), client("success"), noRepo)), EXIT.ready);
});

function recordingProgress() {
  const events: string[] = [];
  const progress = (text: string): Spinner => {
    events.push(`start ${text}`);
    return { update: (t) => events.push(`update ${t}`), stop: () => events.push("stop") };
  };
  return { events, progress };
}

test("the progress indicator says what it is doing and stops before the result is printed", async () => {
  const c = capture();
  const { events, progress } = recordingProgress();
  const order: string[] = [];
  await run(["check", "7"], {
    ...io(c, client("success")),
    out: (s: string) => order.push(`out after ${events.length} events, last: ${events.at(-1)}`),
    progress,
  });
  assert.equal(events[0], "start Checking acme/app#7…");
  assert.equal(events.at(-1), "stop");
  assert.match(order[0] ?? "", /last: stop/);
});

test("--json and --quiet never show the progress indicator", async () => {
  for (const flag of ["--json", "-q"]) {
    const { events, progress } = recordingProgress();
    await run(["check", flag, "7"], { ...io(capture(), client("success")), progress });
    assert.deepEqual(events, [], flag);
  }
});

test("the spinner draws on one line and erases itself", () => {
  let screen = "";
  const s = startSpinner((t) => (screen += t), "Working…", 1_000_000);
  s.update("Still working…");
  s.stop();
  s.stop();
  assert.equal(screen, "\r⠋ Working…\x1b[K\r\x1b[K", "drawn once, erased once; a second stop writes nothing");
});

test("the token comes from GITHUB_TOKEN, then GH_TOKEN, then the gh session", () => {
  const fromGh = () => "from-gh";
  assert.equal(findToken({ GITHUB_TOKEN: "a", GH_TOKEN: "b" }, fromGh), "a");
  assert.equal(findToken({ GH_TOKEN: "b" }, fromGh), "b");
  assert.equal(findToken({}, fromGh), "from-gh");
  assert.equal(findToken({}, () => null), undefined);
});

test("check: the exit code is the verdict", async () => {
  assert.equal(await run(["check", "7"], io(capture(), client("success"))), EXIT.ready);
  assert.equal(await run(["check", "7"], io(capture(), client("failure"))), EXIT.blocked);
});

test("check with no argument finds the pull request of the current branch", async () => {
  const c = capture();
  assert.equal(await run(["check"], io(c, client("success"))), EXIT.ready);
  assert.match(c.out.join("\n"), /acme\/app#7/);
});

test("--quiet prints nothing and still returns the verdict", async () => {
  const c = capture();
  assert.equal(await run(["check", "-q", "7"], io(c, client("failure"))), EXIT.blocked);
  assert.deepEqual(c.out, []);
});

test("--json prints the evaluation", async () => {
  const c = capture();
  await run(["check", "--json", "7"], io(c, client("success")));
  assert.equal(JSON.parse(c.out.join("\n")).verdict, "ready");
});

test("usage errors exit with 64 and point to --help", async () => {
  const c = capture();
  assert.equal(await run(["frobnicate"], io(c, client("success"))), EXIT_USAGE);
  assert.match(c.err.join("\n"), /prot --help/);
  assert.equal(await run(["check", "--bogus"], io(capture(), client("success"))), EXIT_USAGE);
  assert.equal(await run(["list", "-n", "0"], io(capture(), client("success"))), EXIT_USAGE);
});

test("--help goes to standard output and succeeds", async () => {
  const c = capture();
  assert.equal(await run(["--help"], io(c, client("success"))), 0);
  assert.match(c.out.join("\n"), /^protocol - /);
});

test("rules lists what the branch requires", async () => {
  const c = capture();
  assert.equal(await run(["rules", "main"], io(c, client("success"))), 0);
  assert.match(c.out.join("\n"), /check "test"/);
});

/** A pull request whose check reports these results, one per look. */
function sequence(...conclusions: string[]): GitHubClient & { looks: () => number } {
  let looks = 0;
  const pick = () => client(conclusions[Math.min(looks, conclusions.length - 1)] ?? "success");
  return {
    looks: () => looks,
    get: async <T>(p: string) => {
      const answer = await pick().get<T>(p);
      if (p.includes("/check-runs")) looks++;
      return answer;
    },
    tryGet: <T>(p: string) => pick().tryGet<T>(p),
  };
}

test("--watch looks again until the verdict is no longer waiting, and prints only changes", async () => {
  const c = capture();
  const gh = sequence("in_progress", "in_progress", "success");
  const waits: number[] = [];
  const code = await run(["check", "--watch", "--interval", "10", "7"], {
    ...io(c, gh),
    sleep: async (ms: number) => void waits.push(ms),
    now: () => new Date(2026, 9, 21, 14, 5, 9),
  });
  assert.equal(code, EXIT.ready);
  assert.equal(gh.looks(), 3);
  assert.deepEqual(waits, [10_000, 10_000]);
  assert.equal(c.out.length, 2, "the second look changed nothing, so it printed nothing");
  assert.match(c.out[0] ?? "", /^acme\/app#7\nWAITING/);
  assert.match(c.out[1] ?? "", /^\n\[14:05:09\] acme\/app#7\nREADY/);
});

test("--watch stops at once when the pull request is not waiting", async () => {
  const code = await run(["check", "-w", "7"], { ...io(capture(), sequence("failure")), sleep: async () => assert.fail("slept") });
  assert.equal(code, EXIT.blocked);
});

test("--watch --json prints one evaluation per line", async () => {
  const c = capture();
  await run(["check", "-w", "-j", "7"], { ...io(c, sequence("in_progress", "success")), sleep: async () => {} });
  assert.deepEqual(
    c.out.map((l) => JSON.parse(l).verdict),
    ["pending", "ready"],
  );
});

test("options that do not fit the command are usage errors", async () => {
  for (const args of [
    ["list", "-w"],
    ["check", "--interval", "10", "7"],
    ["check", "-w", "--interval", "2", "7"],
    ["check", "-j", "-m", "7"],
    ["check", "--me", "7"],
  ]) {
    const c = capture();
    assert.equal(await run(args, io(c, client("success"))), EXIT_USAGE, args.join(" "));
    assert.match(c.err.join("\n"), /^prot: /, args.join(" "));
  }
});

test("--markdown prints a linked title and the requirement table", async () => {
  const c = capture();
  assert.equal(await run(["check", "-m", "7"], io(c, client("failure"))), EXIT.blocked);
  const md = c.out.join("\n");
  assert.ok(md.startsWith("### [acme/app\\#7](https://github.com/acme/app/pull/7)"), md);
  assert.match(md, /\| ❌ \| Check "test" \| author \|/);
});

test("list --markdown links each pull request and escapes its title", async () => {
  const c = capture();
  await run(["list", "-m"], io(c, client("success")));
  assert.ok(c.out.join("\n").includes("| [#7](https://github.com/acme/app/pull/7) | ✅ Ready | — | Fix login |"));
});

test("list --me keeps only the pull requests where you have to act", async () => {
  const author = capture();
  await run(["list", "--me"], io(author, client("failure", "ana")));
  assert.match(author.out.join("\n"), /#7\s+BLOCKED\s+author\s+Fix login/, "a red check is the author's move");

  const reviewer = capture();
  await run(["list", "--me"], io(reviewer, client("failure", "bob")));
  assert.deepEqual(reviewer.out, ["Nothing is waiting on bob in acme/app."]);
});

test("list --me without a login says how to log in", async () => {
  const c = capture();
  const { client: _unused, ...offline } = io(c, client("success"));
  assert.equal(await run(["list", "--me"], offline), EXIT.unknown);
  assert.match(c.err.join("\n"), /gh auth login/);
});
