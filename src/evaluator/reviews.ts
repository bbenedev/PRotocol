import type { PullRequestState, Requirement, RequirementResult, ReviewEvidence } from "./types.ts";

/**
 * GitHub counts only the latest review of each person, ignoring plain comments.
 * Returns that review per reviewer, never including the pull request author.
 */
export function latestReviews(reviews: ReviewEvidence[], author: string): Map<string, ReviewEvidence> {
  const latest = new Map<string, ReviewEvidence>();
  const ordered = [...reviews].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  for (const r of ordered) {
    if (r.state === "COMMENTED" || r.reviewer === author) continue;
    latest.set(r.reviewer, r);
  }
  return latest;
}

/** Approvals that count: write access confirmed and, when required, on the current head. */
function countableApprovals(
  latest: Map<string, ReviewEvidence>,
  pr: PullRequestState,
  requireCurrentHead: boolean,
): { counted: ReviewEvidence[]; staleHead: ReviewEvidence[]; unknownAccess: ReviewEvidence[] } {
  const counted: ReviewEvidence[] = [];
  const staleHead: ReviewEvidence[] = [];
  const unknownAccess: ReviewEvidence[] = [];
  for (const r of latest.values()) {
    if (r.state !== "APPROVED") continue;
    if (r.hasWriteAccess !== true) {
      unknownAccess.push(r);
      continue;
    }
    if (requireCurrentHead && r.commitSha !== pr.headSha) {
      staleHead.push(r);
      continue;
    }
    counted.push(r);
  }
  return { counted, staleHead, unknownAccess };
}

const urlsOf = (rs: ReviewEvidence[]) => rs.flatMap((r) => (r.url ? [r.url] : []));

/** Change requests from people who can block. Unknown access counts as blocking, to stay safe. */
export function evaluateChangeRequests(
  reviews: ReviewEvidence[],
  pr: PullRequestState,
): RequirementResult | null {
  const blocking = [...latestReviews(reviews, pr.author).values()].filter(
    (r) => r.state === "CHANGES_REQUESTED" && r.hasWriteAccess !== false,
  );
  if (blocking.length === 0) return null;
  const who = blocking.map((r) => r.reviewer);
  return {
    id: "review:changes-requested",
    label: "Requested changes",
    status: "failed",
    actor: { kind: "author", who: [pr.author] },
    explanation:
      `${who.join(", ")} requested changes. Address them and ask for a new review; ` +
      "the request stays until that person approves or it is dismissed.",
    evidenceUrls: urlsOf(blocking),
  };
}

type ApprovalsRequirement = Extract<Requirement, { kind: "approvals" }>;

export function evaluateApprovals(
  req: ApprovalsRequirement,
  reviews: ReviewEvidence[],
  pr: PullRequestState,
): RequirementResult {
  const latest = latestReviews(reviews, pr.author);
  const { counted, staleHead, unknownAccess } = countableApprovals(latest, pr, req.requireCurrentHead);
  const label = `${req.count} approving review${req.count === 1 ? "" : "s"}`;
  if (counted.length >= req.count) {
    return {
      id: "review:approvals",
      label,
      status: "met",
      actor: { kind: "nobody" },
      explanation: `Approved by ${counted.map((r) => r.reviewer).join(", ")}.`,
      evidenceUrls: urlsOf(counted),
    };
  }
  const notes: string[] = [`${counted.length} of ${req.count} approvals count.`];
  if (staleHead.length > 0) {
    notes.push(
      `Approvals from ${staleHead.map((r) => r.reviewer).join(", ")} are for an older commit and ` +
        "the branch rules dismiss them on new pushes.",
    );
  }
  if (unknownAccess.length > 0) {
    notes.push(
      `Approvals from ${unknownAccess.map((r) => r.reviewer).join(", ")} do not count: ` +
        "their write access could not be confirmed.",
    );
  }
  return {
    id: "review:approvals",
    label,
    status: "pending",
    ...(staleHead.length > 0 ? { freshness: "old-head" as const } : {}),
    actor: { kind: "reviewer" },
    explanation: notes.join(" "),
    evidenceUrls: urlsOf([...counted, ...staleHead]),
  };
}

type CodeownersRequirement = Extract<Requirement, { kind: "codeowners" }>;

export function evaluateCodeowners(
  req: CodeownersRequirement,
  reviews: ReviewEvidence[],
  pr: PullRequestState,
): RequirementResult {
  const latest = latestReviews(reviews, pr.author);
  const approvers = new Set(
    [...latest.values()].filter((r) => r.state === "APPROVED" && r.hasWriteAccess === true).map((r) => r.reviewer),
  );
  const waiting = req.groups.filter((g) => !g.owners.some((o) => approvers.has(o)));
  if (waiting.length === 0) {
    return {
      id: "review:codeowners",
      label: "Code owner review",
      status: "met",
      actor: { kind: "nobody" },
      explanation: "Every changed area has an approval from one of its owners.",
      evidenceUrls: [],
    };
  }
  const who = [...new Set(waiting.flatMap((g) => g.owners).filter((o) => o !== pr.author))];
  const lines = waiting.map((g) => `${g.pattern} (${g.owners.join(", ") || "no owners listed"})`);
  return {
    id: "review:codeowners",
    label: "Code owner review",
    status: "pending",
    actor: { kind: "reviewer", who },
    explanation: `Waiting for an owner of: ${lines.join("; ")}.`,
    evidenceUrls: [],
  };
}

type LastPushRequirement = Extract<Requirement, { kind: "last-push-approval" }>;

export function evaluateLastPushApproval(
  req: LastPushRequirement,
  reviews: ReviewEvidence[],
  pr: PullRequestState,
): RequirementResult {
  const id = "review:last-push";
  const label = "Approval of the latest push";
  if (req.lastPusher === null) {
    return {
      id,
      label,
      status: "missing",
      actor: { kind: "maintainer" },
      explanation: "Could not tell who pushed the latest commit, so this cannot be confirmed.",
      evidenceUrls: [],
    };
  }
  const ok = [...latestReviews(reviews, pr.author).values()].filter(
    (r) =>
      r.state === "APPROVED" &&
      r.hasWriteAccess === true &&
      r.commitSha === pr.headSha &&
      r.reviewer !== req.lastPusher,
  );
  if (ok.length > 0) {
    return {
      id,
      label,
      status: "met",
      actor: { kind: "nobody" },
      explanation: `Approved by ${ok.map((r) => r.reviewer).join(", ")}, who did not push it.`,
      evidenceUrls: urlsOf(ok),
    };
  }
  return {
    id,
    label,
    status: "pending",
    actor: { kind: "reviewer" },
    explanation: `The latest push (by ${req.lastPusher}) needs an approval from someone else.`,
    evidenceUrls: [],
  };
}
