import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateApprovals,
  evaluateChangeRequests,
  evaluateCodeowners,
  evaluateLastPushApproval,
  latestReviews,
} from "../../src/evaluator/reviews.ts";
import { OLD_HEAD, pr, review } from "./helpers.ts";

const twoApprovals = { kind: "approvals" as const, count: 2, requireCurrentHead: false };

test("only the latest review of each person counts, and comments are ignored", () => {
  const latest = latestReviews(
    [
      review({ reviewer: "beto", state: "CHANGES_REQUESTED", submittedAt: "2026-10-21T09:00:00Z" }),
      review({ reviewer: "beto", state: "APPROVED", submittedAt: "2026-10-21T10:00:00Z" }),
      review({ reviewer: "beto", state: "COMMENTED", submittedAt: "2026-10-21T11:00:00Z" }),
    ],
    "ana",
  );
  assert.equal(latest.get("beto")?.state, "APPROVED");
});

test("the author's own review never counts", () => {
  assert.equal(latestReviews([review({ reviewer: "ana" })], "ana").size, 0);
});

test("enough approvals with write access are met", () => {
  const r = evaluateApprovals(twoApprovals, [review({ reviewer: "beto" }), review({ reviewer: "caro" })], pr());
  assert.equal(r.status, "met");
});

test("one approval short is pending and names who acts", () => {
  const r = evaluateApprovals(twoApprovals, [review({ reviewer: "beto" })], pr());
  assert.equal(r.status, "pending");
  assert.equal(r.actor.kind, "reviewer");
  assert.match(r.explanation, /1 of 2/);
});

test("an approval without confirmed write access does not count", () => {
  const r = evaluateApprovals(
    { ...twoApprovals, count: 1 },
    [review({ reviewer: "visitor", hasWriteAccess: undefined as never })],
    pr(),
  );
  assert.equal(r.status, "pending");
  assert.match(r.explanation, /visitor/);
});

test("with stale dismissal, an approval of an older commit does not count", () => {
  const r = evaluateApprovals(
    { kind: "approvals", count: 1, requireCurrentHead: true },
    [review({ commitSha: OLD_HEAD })],
    pr(),
  );
  assert.equal(r.status, "pending");
  assert.equal(r.freshness, "old-head");
});

test("without stale dismissal, an approval of an older commit still counts", () => {
  const r = evaluateApprovals({ kind: "approvals", count: 1, requireCurrentHead: false }, [review({ commitSha: OLD_HEAD })], pr());
  assert.equal(r.status, "met");
});

test("a dismissed approval no longer counts", () => {
  const r = evaluateApprovals(
    { ...twoApprovals, count: 1 },
    [
      review({ reviewer: "beto", state: "APPROVED", submittedAt: "2026-10-21T09:00:00Z" }),
      review({ reviewer: "beto", state: "DISMISSED", submittedAt: "2026-10-21T10:00:00Z" }),
    ],
    pr(),
  );
  assert.equal(r.status, "pending");
});

test("a change request blocks and puts the author on it", () => {
  const r = evaluateChangeRequests([review({ reviewer: "caro", state: "CHANGES_REQUESTED" })], pr());
  assert.equal(r?.status, "failed");
  assert.deepEqual(r?.actor.who, ["ana"]);
});

test("a change request from someone known to lack write access does not block", () => {
  assert.equal(
    evaluateChangeRequests([review({ state: "CHANGES_REQUESTED", hasWriteAccess: false })], pr()),
    null,
  );
});

test("a change request with unknown access blocks, to stay on the safe side", () => {
  const r = evaluateChangeRequests(
    [review({ state: "CHANGES_REQUESTED", hasWriteAccess: undefined as never })],
    pr(),
  );
  assert.equal(r?.status, "failed");
});

test("a change request later replaced by an approval no longer blocks", () => {
  const r = evaluateChangeRequests(
    [
      review({ reviewer: "caro", state: "CHANGES_REQUESTED", submittedAt: "2026-10-21T09:00:00Z" }),
      review({ reviewer: "caro", state: "APPROVED", submittedAt: "2026-10-21T10:00:00Z" }),
    ],
    pr(),
  );
  assert.equal(r, null);
});

test("code owners: every group needs one of its owners", () => {
  const req = {
    kind: "codeowners" as const,
    groups: [
      { pattern: "/api/", owners: ["beto"] },
      { pattern: "/web/", owners: ["caro", "dani"] },
    ],
  };
  const partial = evaluateCodeowners(req, [review({ reviewer: "beto" })], pr());
  assert.equal(partial.status, "pending");
  assert.deepEqual(partial.actor.who, ["caro", "dani"]);
  const full = evaluateCodeowners(req, [review({ reviewer: "beto" }), review({ reviewer: "dani" })], pr());
  assert.equal(full.status, "met");
});

test("code owners: the author cannot satisfy their own area", () => {
  const req = { kind: "codeowners" as const, groups: [{ pattern: "/api/", owners: ["ana"] }] };
  const r = evaluateCodeowners(req, [review({ reviewer: "ana" })], pr());
  assert.equal(r.status, "pending");
});

test("latest push: someone other than the pusher must approve the head", () => {
  const req = { kind: "last-push-approval" as const, lastPusher: "beto" };
  assert.equal(evaluateLastPushApproval(req, [review({ reviewer: "beto" })], pr()).status, "pending");
  assert.equal(evaluateLastPushApproval(req, [review({ reviewer: "caro" })], pr()).status, "met");
  assert.equal(
    evaluateLastPushApproval(req, [review({ reviewer: "caro", commitSha: OLD_HEAD })], pr()).status,
    "pending",
  );
});

test("latest push: an unknown pusher is missing, never met", () => {
  const r = evaluateLastPushApproval({ kind: "last-push-approval", lastPusher: null }, [review()], pr());
  assert.equal(r.status, "missing");
});
