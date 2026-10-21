// Turns GitHub's REST answers into the evaluator's input. Anything that cannot be read is
// reported as missing data or as a note: it is never filled in with a guess.

import type {
  CheckConclusion,
  CheckEvidence,
  EvaluationInput,
  Requirement,
  ReviewEvidence,
} from "../evaluator/types.ts";
import type { GitHubClient } from "./api.ts";

// How many earlier commits of the pull request are inspected for older results.
const OLDER_COMMITS = 4;

interface ApiPull {
  state: "open" | "closed";
  draft?: boolean;
  mergeable: boolean | null;
  user: { login: string } | null;
  head: { sha: string };
  base: { ref: string; sha: string };
}
interface ApiBranch {
  protected: boolean;
  protection?: { required_status_checks?: { checks?: { context: string; app_id: number | null }[] } };
}
interface ApiRule {
  type: string;
  parameters?: {
    required_status_checks?: { context: string; integration_id?: number }[];
    strict_required_status_checks_policy?: boolean;
    required_approving_review_count?: number;
    dismiss_stale_reviews_on_push?: boolean;
    require_code_owner_review?: boolean;
    require_last_push_approval?: boolean;
  };
}
interface ApiCheckRun {
  id: number;
  name: string;
  head_sha: string;
  status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
  conclusion: string | null;
  started_at: string | null;
  html_url: string | null;
  app: { id: number; name: string } | null;
}
interface ApiStatus {
  id: number;
  context: string;
  state: "success" | "failure" | "error" | "pending";
  created_at: string;
  target_url: string | null;
}
interface ApiReview {
  id: number;
  user: { login: string } | null;
  state: string;
  commit_id: string;
  submitted_at?: string;
  html_url: string;
}

export interface PullRef {
  owner: string;
  repo: string;
  number: number;
}

/** "owner/repo#12" or a pull request URL. */
export function parsePullRef(text: string): PullRef | null {
  const m =
    /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(text.trim()) ??
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(text.trim());
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

const CONCLUSIONS = new Set<string>(["success", "neutral", "skipped", "failure", "cancelled", "timed_out", "action_required", "stale"]);

export function toCheckEvidence(run: ApiCheckRun): CheckEvidence {
  const completed = run.status === "completed";
  const base: CheckEvidence = {
    id: `check-run:${run.id}`,
    name: run.name,
    commitSha: run.head_sha,
    status: completed ? "completed" : run.status === "in_progress" ? "in_progress" : "queued",
    startedAt: run.started_at ?? "",
  };
  // Check runs do not say which base they tested against, so baseSha stays unknown.
  return {
    ...base,
    ...(run.app ? { appId: run.app.id, appName: run.app.name } : {}),
    ...(completed && run.conclusion && CONCLUSIONS.has(run.conclusion)
      ? { conclusion: run.conclusion as CheckConclusion }
      : {}),
    ...(run.html_url ? { url: run.html_url } : {}),
  };
}

export function toStatusEvidence(s: ApiStatus, commitSha: string): CheckEvidence {
  const conclusion: CheckConclusion | undefined =
    s.state === "success" ? "success" : s.state === "pending" ? undefined : "failure";
  return {
    id: `status:${s.id}`,
    name: s.context,
    commitSha,
    status: s.state === "pending" ? "in_progress" : "completed",
    startedAt: s.created_at,
    ...(conclusion ? { conclusion } : {}),
    ...(s.target_url ? { url: s.target_url } : {}),
  };
}

/** Statuses come newest first and keep their history: only the latest per context counts. */
function latestStatuses(statuses: ApiStatus[], commitSha: string): CheckEvidence[] {
  const seen = new Set<string>();
  const out: CheckEvidence[] = [];
  for (const s of statuses) {
    if (seen.has(s.context)) continue;
    seen.add(s.context);
    out.push(toStatusEvidence(s, commitSha));
  }
  return out;
}

export function requirementsFrom(branch: ApiBranch, rules: ApiRule[], notes: string[]): Requirement[] {
  const reqs: Requirement[] = [];
  const seen = new Set<string>();
  const addCheck = (context: string, appId: number | null | undefined, strict: boolean | undefined) => {
    if (seen.has(context)) return;
    seen.add(context);
    reqs.push({
      kind: "check",
      context,
      ...(appId ? { appId } : {}),
      ...(strict !== undefined ? { strict } : {}),
    });
  };

  for (const rule of rules) {
    const p = rule.parameters ?? {};
    if (rule.type === "required_status_checks") {
      for (const c of p.required_status_checks ?? []) addCheck(c.context, c.integration_id, p.strict_required_status_checks_policy);
    }
    if (rule.type === "pull_request") {
      if ((p.required_approving_review_count ?? 0) > 0) {
        reqs.push({
          kind: "approvals",
          count: p.required_approving_review_count ?? 0,
          requireCurrentHead: p.dismiss_stale_reviews_on_push === true,
        });
      }
      if (p.require_last_push_approval) reqs.push({ kind: "last-push-approval", lastPusher: null });
    }
  }
  for (const c of branch.protection?.required_status_checks?.checks ?? []) addCheck(c.context, c.app_id, undefined);

  if (branch.protected) {
    notes.push(
      "The base branch is protected. Review rules of classic branch protection are only visible to repository admins; if it uses them, they are not included.",
    );
  }
  return reqs;
}

export async function readPullRequest(gh: GitHubClient, ref: PullRef): Promise<EvaluationInput> {
  const repo = `/repos/${ref.owner}/${ref.repo}`;
  const missingData: string[] = [];
  const notes: string[] = [];

  const pull = await gh.get<ApiPull>(`${repo}/pulls/${ref.number}`);
  const baseRef = encodeURIComponent(pull.base.ref);
  const [branch, rules, commits, reviews] = await Promise.all([
    gh.get<ApiBranch>(`${repo}/branches/${baseRef}`),
    gh.tryGet<ApiRule[]>(`${repo}/rules/branches/${baseRef}`),
    gh.get<{ sha: string }[]>(`${repo}/pulls/${ref.number}/commits?per_page=100`),
    gh.get<ApiReview[]>(`${repo}/pulls/${ref.number}/reviews?per_page=100`),
  ]);
  if (rules === null) missingData.push("the rulesets of the base branch");

  const requirements = requirementsFrom(branch, rules ?? [], notes);
  if ((rules ?? []).some((r) => r.type === "pull_request" && r.parameters?.require_code_owner_review)) {
    missingData.push("code owner rules (not supported yet)");
  }

  // Head first, then a few earlier commits, to recognise results that belong to older pushes.
  const shas = [pull.head.sha, ...commits.map((c) => c.sha).filter((s) => s !== pull.head.sha).slice(-OLDER_COMMITS)];
  const checks: CheckEvidence[] = [];
  for (const sha of shas) {
    const [runs, statuses] = await Promise.all([
      gh.get<{ check_runs: ApiCheckRun[] }>(`${repo}/commits/${sha}/check-runs?per_page=100`),
      gh.get<ApiStatus[]>(`${repo}/commits/${sha}/statuses?per_page=100`),
    ]);
    checks.push(...runs.check_runs.map(toCheckEvidence), ...latestStatuses(statuses, sha));
  }

  const author = pull.user?.login ?? "";
  const reviewers = [...new Set(reviews.map((r) => r.user?.login).filter((l): l is string => !!l && l !== author))];
  const access = new Map<string, boolean | undefined>();
  await Promise.all(
    reviewers.map(async (login) => {
      // Readable only with push access to the repository; otherwise access stays unknown.
      const p = await gh.tryGet<{ permission: string }>(`${repo}/collaborators/${encodeURIComponent(login)}/permission`);
      access.set(login, p ? ["admin", "maintain", "write"].includes(p.permission) : undefined);
    }),
  );
  if (reviewers.some((l) => access.get(l) === undefined)) {
    notes.push("Write access of some reviewers could not be confirmed, so their approvals do not count.");
  }

  const reviewEvidence: ReviewEvidence[] = reviews
    .filter((r) => r.user && ["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"].includes(r.state))
    .map((r) => {
      const known = access.get(r.user?.login ?? "");
      return {
        id: `review:${r.id}`,
        reviewer: r.user?.login ?? "",
        state: r.state as ReviewEvidence["state"],
        commitSha: r.commit_id,
        submittedAt: r.submitted_at ?? "",
        url: r.html_url,
        ...(known !== undefined ? { hasWriteAccess: known } : {}),
      };
    });

  return {
    pr: {
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
      author,
      state: pull.state,
      draft: pull.draft === true,
      headSha: pull.head.sha,
      baseRef: pull.base.ref,
      baseSha: pull.base.sha,
      mergeable: pull.mergeable,
    },
    requirements,
    checks,
    reviews: reviewEvidence,
    missingData,
    notes,
  };
}
