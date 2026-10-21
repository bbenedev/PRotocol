import type { CheckEvidence, EvaluationInput, PullRequestState, ReviewEvidence } from "../../src/evaluator/types.ts";

export const HEAD = "a".repeat(40);
export const OLD_HEAD = "b".repeat(40);
export const BASE = "c".repeat(40);
export const OLD_BASE = "d".repeat(40);

export function pr(over: Partial<PullRequestState> = {}): PullRequestState {
  return {
    owner: "acme",
    repo: "app",
    number: 7,
    author: "ana",
    state: "open",
    draft: false,
    headSha: HEAD,
    baseRef: "main",
    baseSha: BASE,
    mergeable: true,
    ...over,
  };
}

let seq = 0;

export function check(over: Partial<CheckEvidence> = {}): CheckEvidence {
  seq += 1;
  return {
    id: `c${seq}`,
    name: "ci/test",
    appId: 15368,
    appName: "GitHub Actions",
    commitSha: HEAD,
    baseSha: BASE,
    status: "completed",
    conclusion: "success",
    startedAt: `2026-10-21T10:00:${String(seq % 60).padStart(2, "0")}Z`,
    url: `https://github.com/acme/app/runs/${seq}`,
    ...over,
  };
}

export function review(over: Partial<ReviewEvidence> = {}): ReviewEvidence {
  seq += 1;
  return {
    id: `r${seq}`,
    reviewer: "beto",
    state: "APPROVED",
    commitSha: HEAD,
    submittedAt: `2026-10-21T11:00:${String(seq % 60).padStart(2, "0")}Z`,
    hasWriteAccess: true,
    url: `https://github.com/acme/app/pull/7#review-${seq}`,
    ...over,
  };
}

export function input(over: Partial<EvaluationInput> = {}): EvaluationInput {
  return { pr: pr(), requirements: [], checks: [], reviews: [], missingData: [], ...over };
}
