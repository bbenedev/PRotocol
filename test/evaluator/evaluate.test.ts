import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../../src/evaluator/evaluate.ts";
import type { Requirement } from "../../src/evaluator/types.ts";
import { OLD_HEAD, check, input, pr, review } from "./helpers.ts";

const ciAndOneApproval: Requirement[] = [
  { kind: "check", context: "ci/test" },
  { kind: "approvals", count: 1, requireCurrentHead: true },
];

test("everything met is ready", () => {
  const e = evaluate(input({ requirements: ciAndOneApproval, checks: [check()], reviews: [review()] }));
  assert.equal(e.verdict, "ready");
});

test("any data the GitHub layer could not read makes the verdict unknown", () => {
  const e = evaluate(
    input({ requirements: ciAndOneApproval, checks: [check()], reviews: [review()], missingData: ["branch rules"] }),
  );
  assert.equal(e.verdict, "unknown");
  assert.match(e.notes[0] ?? "", /branch rules/);
});

test("a failure wins over a pending requirement", () => {
  const e = evaluate(input({ requirements: ciAndOneApproval, checks: [check({ conclusion: "failure" })] }));
  assert.equal(e.verdict, "blocked");
});

test("a missing required check is pending, never ready", () => {
  const e = evaluate(input({ requirements: ciAndOneApproval, reviews: [review()] }));
  assert.equal(e.verdict, "pending");
});

test("a green check from an older commit keeps the pull request waiting", () => {
  const e = evaluate(
    input({ requirements: ciAndOneApproval, checks: [check({ commitSha: OLD_HEAD })], reviews: [review()] }),
  );
  assert.equal(e.verdict, "pending");
});

test("a draft is blocked even with everything green", () => {
  const e = evaluate(
    input({ pr: pr({ draft: true }), requirements: ciAndOneApproval, checks: [check()], reviews: [review()] }),
  );
  assert.equal(e.verdict, "blocked");
  assert.ok(e.results.some((r) => r.id === "pr:draft"));
});

test("conflicts block; GitHub still computing them waits", () => {
  assert.equal(evaluate(input({ pr: pr({ mergeable: false }) })).verdict, "blocked");
  assert.equal(evaluate(input({ pr: pr({ mergeable: null }) })).verdict, "pending");
});

test("change requests only block when the branch requires reviews", () => {
  const changes = [review({ state: "CHANGES_REQUESTED" })];
  assert.equal(evaluate(input({ reviews: changes })).verdict, "ready");
  assert.equal(
    evaluate(input({ requirements: ciAndOneApproval, checks: [check()], reviews: [...changes, review({ reviewer: "caro" })] }))
      .verdict,
    "blocked",
  );
});

test("with no requirements, the note says so and the pull request can be ready", () => {
  const e = evaluate(input());
  assert.equal(e.verdict, "ready");
  assert.match(e.notes.join(" "), /no required checks or reviews/);
});

test("a closed pull request is not evaluated", () => {
  const e = evaluate(input({ pr: pr({ state: "closed" }) }));
  assert.equal(e.verdict, "unknown");
  assert.equal(e.results.length, 0);
});

test("a passing check with an unknown base is still ready but leaves a note", () => {
  const e = evaluate(
    input({
      requirements: [{ kind: "check", context: "ci/test" }],
      checks: [check({ baseSha: undefined as never })],
    }),
  );
  assert.equal(e.verdict, "ready");
  assert.match(e.notes.join(" "), /do not say which base/);
});

test("the evaluation carries the exact commits it judged", () => {
  const e = evaluate(input());
  assert.equal(e.headSha, pr().headSha);
  assert.equal(e.baseSha, pr().baseSha);
});
