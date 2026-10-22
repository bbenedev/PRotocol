import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitHubClient } from "../../src/github/api.ts";
import { parsePullRef, readPullRequest, requirementsFrom, toStatusEvidence } from "../../src/github/read.ts";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const BASE = "c".repeat(40);

/** A fake GitHub: answers by path, null means 404 for tryGet. */
function fake(routes: Record<string, unknown>): GitHubClient {
  const find = (path: string) => {
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    return key === undefined ? undefined : routes[key];
  };
  return {
    get: async <T>(path: string) => {
      const v = find(path);
      if (v === undefined || v === null) throw new Error(`unexpected GET ${path}`);
      return v as T;
    },
    tryGet: async <T>(path: string) => (find(path) ?? null) as T | null,
  };
}

const R = "/repos/acme/app";
function routes(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [`${R}/pulls/7/commits`]: [{ sha: OLD }, { sha: HEAD }],
    [`${R}/pulls/7/reviews`]: [],
    [`${R}/pulls/7`]: {
      state: "open",
      draft: false,
      mergeable: true,
      user: { login: "ana" },
      head: { sha: HEAD },
      base: { ref: "main", sha: BASE },
    },
    [`${R}/branches/main`]: { protected: false },
    [`${R}/rules/branches/main`]: [
      { type: "required_status_checks", parameters: { required_status_checks: [{ context: "test", integration_id: 15368 }], strict_required_status_checks_policy: false } },
    ],
    [`${R}/commits/${HEAD}/check-runs`]: { check_runs: [] },
    [`${R}/commits/${HEAD}/statuses`]: [],
    [`${R}/commits/${OLD}/check-runs`]: {
      check_runs: [
        { id: 1, name: "test", head_sha: OLD, status: "completed", conclusion: "success", started_at: "2026-10-20T10:00:00Z", html_url: "https://github.com/acme/app/runs/1", app: { id: 15368, name: "GitHub Actions" } },
      ],
    },
    [`${R}/commits/${OLD}/statuses`]: [],
    ...over,
  };
}

test("parses owner/repo#number and pull request URLs", () => {
  assert.deepEqual(parsePullRef("acme/app#7"), { owner: "acme", repo: "app", number: 7 });
  assert.deepEqual(parsePullRef("https://github.com/acme/my.app/pull/12/files"), { owner: "acme", repo: "my.app", number: 12 });
  assert.equal(parsePullRef("https://github.com/acme/app/pull/12x"), null);
  assert.deepEqual(parsePullRef("https://github.com/acme/my.app/pull/12"), { owner: "acme", repo: "my.app", number: 12 });
  assert.equal(parsePullRef("acme/app 7"), null);
});

test("rulesets and classic required checks become check requirements, without duplicates", () => {
  const notes: string[] = [];
  const reqs = requirementsFrom(
    { protected: true, protection: { enabled: true, required_status_checks: { checks: [{ context: "test", app_id: null }, { context: "lint", app_id: 9 }] } } },
    [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "test", integration_id: 1 }], strict_required_status_checks_policy: true } }],
    notes,
  );
  assert.deepEqual(reqs, [
    { kind: "check", context: "test", appId: 1, strict: true },
    { kind: "check", context: "lint", appId: 9 },
  ]);
  assert.match(notes[0] ?? "", /only visible to repository admins/);
});

test("a branch protected only by rulesets gets no note about classic protection", () => {
  const notes: string[] = [];
  requirementsFrom({ protected: true, protection: { enabled: false } }, [], notes);
  assert.deepEqual(notes, []);
});

test("readable classic protection adds its reviews and strict checks instead of a note", () => {
  const notes: string[] = [];
  const reqs = requirementsFrom({ protected: true, protection: { enabled: true } }, [], notes, {
    required_status_checks: { strict: true, checks: [{ context: "build", app_id: 15368 }] },
    required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true, require_last_push_approval: true },
  });
  assert.deepEqual(reqs, [
    { kind: "check", context: "build", appId: 15368, strict: true },
    { kind: "approvals", count: 1, requireCurrentHead: true },
    { kind: "last-push-approval", lastPusher: null },
  ]);
  assert.deepEqual(notes, []);
});

test("pull request rules become approval and latest-push requirements", () => {
  const reqs = requirementsFrom(
    { protected: false },
    [{ type: "pull_request", parameters: { required_approving_review_count: 2, dismiss_stale_reviews_on_push: true, require_last_push_approval: true } }],
    [],
  );
  assert.deepEqual(reqs, [
    { kind: "approvals", count: 2, requireCurrentHead: true },
    { kind: "last-push-approval", lastPusher: null },
  ]);
});

test("a commit status maps pending to unfinished and error to failure", () => {
  const base = { id: 1, context: "ci", created_at: "2026-10-21T10:00:00Z", target_url: null };
  assert.equal(toStatusEvidence({ ...base, state: "pending" }, HEAD).status, "in_progress");
  assert.equal(toStatusEvidence({ ...base, state: "error" }, HEAD).conclusion, "failure");
  assert.equal(toStatusEvidence({ ...base, state: "success" }, HEAD).conclusion, "success");
});

test("a green run that only exists on an older commit is read with that commit", async () => {
  const input = await readPullRequest(fake(routes()), { owner: "acme", repo: "app", number: 7 });
  assert.equal(input.pr.headSha, HEAD);
  assert.equal(input.checks.length, 1);
  assert.equal(input.checks[0]?.commitSha, OLD);
  assert.equal(input.checks[0]?.baseSha, undefined);
  assert.deepEqual(input.missingData, []);
});

test("rulesets that cannot be read are missing data, never an empty rule list", async () => {
  const input = await readPullRequest(fake(routes({ [`${R}/rules/branches/main`]: null })), { owner: "acme", repo: "app", number: 7 });
  assert.deepEqual(input.missingData, ["the rulesets of the base branch"]);
});

test("code owner rules are reported as not supported instead of ignored", async () => {
  const input = await readPullRequest(
    fake(routes({ [`${R}/rules/branches/main`]: [{ type: "pull_request", parameters: { require_code_owner_review: true } }] })),
    { owner: "acme", repo: "app", number: 7 },
  );
  assert.ok(input.missingData.some((m) => m.includes("code owner")));
});

test("a reviewer whose access cannot be read keeps unknown access and adds a note", async () => {
  const input = await readPullRequest(
    fake(routes({ [`${R}/pulls/7/reviews`]: [{ id: 5, user: { login: "beto" }, state: "APPROVED", commit_id: HEAD, submitted_at: "2026-10-21T11:00:00Z", html_url: "https://github.com/x" }] })),
    { owner: "acme", repo: "app", number: 7 },
  );
  assert.equal(input.reviews[0]?.hasWriteAccess, undefined);
  assert.ok(input.notes?.some((n) => n.includes("could not be confirmed")));
});

test("a reviewer with write permission is marked as such", async () => {
  const input = await readPullRequest(
    fake(
      routes({
        [`${R}/pulls/7/reviews`]: [{ id: 5, user: { login: "beto" }, state: "APPROVED", commit_id: HEAD, submitted_at: "2026-10-21T11:00:00Z", html_url: "https://github.com/x" }],
        [`${R}/collaborators/beto/permission`]: { permission: "write" },
      }),
    ),
    { owner: "acme", repo: "app", number: 7 },
  );
  assert.equal(input.reviews[0]?.hasWriteAccess, true);
});

test("the head commit's age comes from its committer date", async () => {
  const commits = { [`${R}/pulls/7/commits`]: [{ sha: OLD }, { sha: HEAD, commit: { committer: { date: "2026-10-21T10:00:00Z" } } }] };
  const input = await readPullRequest(fake(routes(commits)), { owner: "acme", repo: "app", number: 7 }, new Date("2026-10-21T10:01:30Z"));
  assert.equal(input.pr.headAgeSeconds, 90);
  const unknown = await readPullRequest(fake(routes()), { owner: "acme", repo: "app", number: 7 });
  assert.equal(unknown.pr.headAgeSeconds, undefined, "no date, no guess");
});
