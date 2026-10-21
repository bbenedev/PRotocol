import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCheck } from "../../src/evaluator/checks.ts";
import { BASE, HEAD, OLD_BASE, OLD_HEAD, check, pr } from "./helpers.ts";

const required = { kind: "check" as const, context: "ci/test" };

test("a passing check on the current commit and base is met and current", () => {
  const r = evaluateCheck(required, [check()], pr());
  assert.equal(r.status, "met");
  assert.equal(r.freshness, "current");
});

test("neutral and skipped pass, as on GitHub", () => {
  for (const conclusion of ["neutral", "skipped"] as const) {
    assert.equal(evaluateCheck(required, [check({ conclusion })], pr()).status, "met");
  }
});

test("a green check on an older commit does not count for the current head", () => {
  const r = evaluateCheck(required, [check({ commitSha: OLD_HEAD })], pr());
  assert.equal(r.status, "pending");
  assert.equal(r.freshness, "old-head");
  assert.match(r.explanation, /bbbbbbb/);
});

test("no result at all is missing, never met", () => {
  const r = evaluateCheck(required, [], pr());
  assert.equal(r.status, "missing");
  assert.equal(r.actor.kind, "maintainer");
});

test("a check with the right name from the wrong app does not count", () => {
  const r = evaluateCheck({ ...required, appId: 1 }, [check({ appId: 2, appName: "Impostor" })], pr());
  assert.equal(r.status, "missing");
  assert.match(r.explanation, /Impostor/);
});

test("the newest run on the head wins over an older failure (a re-run)", () => {
  const failed = check({ conclusion: "failure", startedAt: "2026-10-21T09:00:00Z" });
  const rerun = check({ conclusion: "success", startedAt: "2026-10-21T09:30:00Z" });
  assert.equal(evaluateCheck(required, [rerun, failed], pr()).status, "met");
});

test("a newer failure wins over an older success", () => {
  const ok = check({ conclusion: "success", startedAt: "2026-10-21T09:00:00Z" });
  const bad = check({ conclusion: "failure", startedAt: "2026-10-21T09:30:00Z" });
  const r = evaluateCheck(required, [ok, bad], pr());
  assert.equal(r.status, "failed");
  assert.equal(r.actor.kind, "author");
});

test("queued and running are pending and wait on CI", () => {
  for (const status of ["queued", "in_progress"] as const) {
    const r = evaluateCheck(required, [check({ status, conclusion: undefined as never })], pr());
    assert.equal(r.status, "pending");
    assert.equal(r.actor.kind, "ci");
  }
});

test("every failing conclusion fails", () => {
  for (const conclusion of ["failure", "cancelled", "timed_out", "action_required"] as const) {
    assert.equal(evaluateCheck(required, [check({ conclusion })], pr()).status, "failed");
  }
});

test("a stale conclusion needs a new run", () => {
  assert.equal(evaluateCheck(required, [check({ conclusion: "stale" })], pr()).status, "pending");
});

test("an older base still passes when the rules do not require an up-to-date branch", () => {
  const r = evaluateCheck(required, [check({ baseSha: OLD_BASE })], pr());
  assert.equal(r.status, "met");
  assert.equal(r.freshness, "old-base");
  assert.match(r.explanation, /older base/);
});

test("an older base is pending when the rules require an up-to-date branch", () => {
  const r = evaluateCheck({ ...required, strict: true }, [check({ baseSha: OLD_BASE })], pr());
  assert.equal(r.status, "pending");
  assert.equal(r.actor.kind, "author");
});

test("an unknown base passes but says so", () => {
  const r = evaluateCheck(required, [check({ baseSha: undefined as never })], pr());
  assert.equal(r.status, "met");
  assert.equal(r.freshness, "base-unknown");
});

test("results for other check names are ignored", () => {
  assert.equal(evaluateCheck(required, [check({ name: "lint" })], pr()).status, "missing");
});

test("uses the current head and base of the pull request", () => {
  const r = evaluateCheck(required, [check({ commitSha: HEAD, baseSha: BASE })], pr());
  assert.equal(r.freshness, "current");
});
