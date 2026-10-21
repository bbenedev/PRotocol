// Domain types for the evaluator. Everything here is plain data: the GitHub layer
// fills it in, the evaluator reads it, nothing in this folder talks to the network.

export type Verdict = "ready" | "blocked" | "pending" | "unknown";

export interface PullRequestState {
  owner: string;
  repo: string;
  number: number;
  author: string;
  state: "open" | "closed";
  draft: boolean;
  headSha: string;
  baseRef: string;
  baseSha: string;
  /** GitHub's own answer: null while GitHub is still computing it. */
  mergeable: boolean | null;
}

/** A requirement GitHub enforces on the base branch, as read from rulesets or branch protection. */
export type Requirement =
  | {
      kind: "check";
      context: string;
      /** When set, only a check published by this GitHub App counts. */
      appId?: number;
      /** "Require branches to be up to date": a result against an older base does not count. */
      strict?: boolean;
    }
  | {
      kind: "approvals";
      count: number;
      /** "Dismiss stale approvals": only approvals of the current head commit count. */
      requireCurrentHead: boolean;
    }
  | {
      kind: "codeowners";
      /** One group per CODEOWNERS entry that matches a changed file; teams already expanded. */
      groups: { pattern: string; owners: string[] }[];
    }
  | {
      kind: "last-push-approval";
      /** Login of whoever pushed the head commit; null when it could not be determined. */
      lastPusher: string | null;
    };

export type CheckStatus = "queued" | "in_progress" | "completed";
export type CheckConclusion =
  | "success"
  | "neutral"
  | "skipped"
  | "failure"
  | "cancelled"
  | "timed_out"
  | "action_required"
  | "stale";

/** A check run or a commit status, normalised by the GitHub layer. */
export interface CheckEvidence {
  id: string;
  name: string;
  appId?: number;
  appName?: string;
  commitSha: string;
  /** Base commit the run tested against, when the provider says so. */
  baseSha?: string;
  status: CheckStatus;
  conclusion?: CheckConclusion;
  startedAt: string;
  url?: string;
}

export interface ReviewEvidence {
  id: string;
  reviewer: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
  commitSha: string;
  submittedAt: string;
  /** Whether the reviewer has write access. Unknown never helps a pull request become ready. */
  hasWriteAccess?: boolean;
  url?: string;
}

export type Freshness = "current" | "old-head" | "old-base" | "base-unknown";

export type ResultStatus = "met" | "pending" | "failed" | "missing";

export type ActorKind = "author" | "reviewer" | "ci" | "maintainer" | "nobody";

export interface RequirementResult {
  /** Stable id, for example "check:ci/test" or "pr:draft". */
  id: string;
  label: string;
  status: ResultStatus;
  freshness?: Freshness;
  actor: { kind: ActorKind; who?: string[] };
  explanation: string;
  evidenceUrls: string[];
}

export interface EvaluationInput {
  pr: PullRequestState;
  requirements: Requirement[];
  checks: CheckEvidence[];
  reviews: ReviewEvidence[];
  /** Anything the GitHub layer could not read. Non-empty means the verdict is "unknown". */
  missingData: string[];
}

export interface Evaluation {
  verdict: Verdict;
  headSha: string;
  baseSha: string;
  results: RequirementResult[];
  /** Notes that do not change the verdict, such as "base unknown for 2 checks". */
  notes: string[];
}
