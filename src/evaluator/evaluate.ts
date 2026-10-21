import { evaluateCheck } from "./checks.ts";
import {
  evaluateApprovals,
  evaluateChangeRequests,
  evaluateCodeowners,
  evaluateLastPushApproval,
} from "./reviews.ts";
import type { Evaluation, EvaluationInput, RequirementResult, Verdict } from "./types.ts";

function pullRequestResults(input: EvaluationInput): RequirementResult[] {
  const { pr } = input;
  const out: RequirementResult[] = [];
  if (pr.draft) {
    out.push({
      id: "pr:draft",
      label: "Ready for review",
      status: "failed",
      actor: { kind: "author", who: [pr.author] },
      explanation: "The pull request is a draft. Mark it ready for review when it is done.",
      evidenceUrls: [],
    });
  }
  if (pr.mergeable === false) {
    out.push({
      id: "pr:conflicts",
      label: "No merge conflicts",
      status: "failed",
      actor: { kind: "author", who: [pr.author] },
      explanation: `It conflicts with ${pr.baseRef}. Merge or rebase ${pr.baseRef} into the branch and resolve the conflicts.`,
      evidenceUrls: [],
    });
  } else if (pr.mergeable === null) {
    out.push({
      id: "pr:conflicts",
      label: "No merge conflicts",
      status: "pending",
      actor: { kind: "nobody" },
      explanation: "GitHub is still checking for conflicts.",
      evidenceUrls: [],
    });
  }
  return out;
}

function requirementResults(input: EvaluationInput): RequirementResult[] {
  const { pr, checks, reviews } = input;
  const out: RequirementResult[] = [];
  const reviewsRequired = input.requirements.some((r) => r.kind !== "check");
  for (const req of input.requirements) {
    switch (req.kind) {
      case "check":
        out.push(evaluateCheck(req, checks, pr));
        break;
      case "approvals":
        out.push(evaluateApprovals(req, reviews, pr));
        break;
      case "codeowners":
        out.push(evaluateCodeowners(req, reviews, pr));
        break;
      case "last-push-approval":
        out.push(evaluateLastPushApproval(req, reviews, pr));
        break;
    }
  }
  // A change request only blocks when the branch requires reviews at all, as on GitHub.
  if (reviewsRequired) {
    const changes = evaluateChangeRequests(reviews, pr);
    if (changes) out.push(changes);
  }
  return out;
}

/**
 * The verdict, in this order (first match wins):
 *   closed -> nothing to evaluate; missing data -> unknown; any failed -> blocked;
 *   any pending or missing -> pending; otherwise ready.
 * Missing evidence is never treated as passing.
 */
export function evaluate(input: EvaluationInput): Evaluation {
  const base = { headSha: input.pr.headSha, baseSha: input.pr.baseSha };
  if (input.pr.state === "closed") {
    return { ...base, verdict: "unknown", results: [], notes: ["The pull request is closed."] };
  }
  if (input.missingData.length > 0) {
    return {
      ...base,
      verdict: "unknown",
      results: [],
      notes: input.missingData.map((m) => `Could not read: ${m}.`),
    };
  }

  const results = [...pullRequestResults(input), ...requirementResults(input)];
  const notes: string[] = [...(input.notes ?? [])];
  if (input.requirements.length === 0) {
    notes.push("The base branch has no required checks or reviews, so only drafts and conflicts can block.");
  }
  const baseUnknown = results.filter((r) => r.status === "met" && r.freshness === "base-unknown").length;
  if (baseUnknown > 0) {
    notes.push(`${baseUnknown} passing check(s) do not say which base they tested against.`);
  }

  let verdict: Verdict = "ready";
  if (results.some((r) => r.status === "failed")) verdict = "blocked";
  else if (results.some((r) => r.status === "pending" || r.status === "missing")) verdict = "pending";

  return { ...base, verdict, results, notes };
}
