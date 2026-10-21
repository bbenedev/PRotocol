import assert from "node:assert/strict";
import { test } from "node:test";
import { EXIT, EXIT_USAGE, findToken, run } from "../../src/cli/main.ts";
import { clean, formatList, plain } from "../../src/cli/render.ts";
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

function client(checkConclusion: string): GitHubClient {
  const routes: [string, unknown][] = [
    ["/repos/acme/app/pulls/7/commits", [{ sha: HEAD }]],
    ["/repos/acme/app/pulls/7/reviews", []],
    ["/repos/acme/app/pulls/7", { state: "open", draft: false, mergeable: true, user: { login: "ana" }, head: { sha: HEAD }, base: { ref: "main", sha: BASE } }],
    ["/repos/acme/app/pulls?state=open&head=", [{ number: 7 }]],
    ["/repos/acme/app/branches/main", { protected: false }],
    ["/repos/acme/app/rules/branches/main", [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "test" }] } }]],
    [`/repos/acme/app/commits/${HEAD}/check-runs`, { check_runs: [{ id: 1, name: "test", head_sha: HEAD, status: "completed", conclusion: checkConclusion, started_at: "2026-10-21T10:00:00Z", html_url: null, app: null }] }],
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
