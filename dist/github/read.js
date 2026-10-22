// Turns GitHub's REST answers into the evaluator's input. Anything that cannot be read is
// reported as missing data or as a note: it is never filled in with a guess.
// How many earlier commits of the pull request are inspected for older results.
const OLDER_COMMITS = 4;
/** "owner/repo#12" or a pull request URL. */
export function parsePullRef(text) {
    const m = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(text.trim()) ??
        /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(text.trim());
    if (!m || !m[1] || !m[2] || !m[3])
        return null;
    return { owner: m[1], repo: m[2], number: Number(m[3]) };
}
const CONCLUSIONS = new Set(["success", "neutral", "skipped", "failure", "cancelled", "timed_out", "action_required", "stale"]);
export function toCheckEvidence(run) {
    const completed = run.status === "completed";
    const base = {
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
            ? { conclusion: run.conclusion }
            : {}),
        ...(run.html_url ? { url: run.html_url } : {}),
    };
}
export function toStatusEvidence(s, commitSha) {
    const conclusion = s.state === "success" ? "success" : s.state === "pending" ? undefined : "failure";
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
function latestStatuses(statuses, commitSha) {
    const seen = new Set();
    const out = [];
    for (const s of statuses) {
        if (seen.has(s.context))
            continue;
        seen.add(s.context);
        out.push(toStatusEvidence(s, commitSha));
    }
    return out;
}
export function requirementsFrom(branch, rules, notes, classic = null) {
    const reqs = [];
    const seen = new Set();
    const addCheck = (context, appId, strict) => {
        if (seen.has(context))
            return;
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
            for (const c of p.required_status_checks ?? [])
                addCheck(c.context, c.integration_id, p.strict_required_status_checks_policy);
        }
        if (rule.type === "pull_request") {
            if ((p.required_approving_review_count ?? 0) > 0) {
                reqs.push({
                    kind: "approvals",
                    count: p.required_approving_review_count ?? 0,
                    requireCurrentHead: p.dismiss_stale_reviews_on_push === true,
                });
            }
            if (p.require_last_push_approval)
                reqs.push({ kind: "last-push-approval", lastPusher: null });
        }
    }
    if (classic) {
        const strict = classic.required_status_checks?.strict;
        for (const c of classic.required_status_checks?.checks ?? [])
            addCheck(c.context, c.app_id, strict);
        const r = classic.required_pull_request_reviews;
        if (r && (r.required_approving_review_count ?? 0) > 0) {
            reqs.push({ kind: "approvals", count: r.required_approving_review_count ?? 0, requireCurrentHead: r.dismiss_stale_reviews === true });
        }
        if (r?.require_last_push_approval)
            reqs.push({ kind: "last-push-approval", lastPusher: null });
    }
    for (const c of branch.protection?.required_status_checks?.checks ?? [])
        addCheck(c.context, c.app_id, undefined);
    if (branch.protection?.enabled === true && !classic) {
        notes.push("The base branch uses classic branch protection. Its review rules are only visible to repository admins, so they are not included.");
    }
    return reqs;
}
/** What GitHub requires before merging into `branch`, as far as the caller is allowed to see. */
export async function readBranchRules(gh, owner, repo, branch) {
    const path = `/repos/${owner}/${repo}`;
    const b = encodeURIComponent(branch);
    const [info, rules] = await Promise.all([
        gh.get(`${path}/branches/${b}`),
        gh.tryGet(`${path}/rules/branches/${b}`),
    ]);
    const missingData = [];
    const notes = [];
    if (rules === null)
        missingData.push("the rulesets of the base branch");
    const classic = info.protection?.enabled === true ? await gh.tryGet(`${path}/branches/${b}/protection`) : null;
    const requirements = requirementsFrom(info, rules ?? [], notes, classic);
    const codeOwners = (rules ?? []).some((r) => r.type === "pull_request" && r.parameters?.require_code_owner_review) ||
        classic?.required_pull_request_reviews?.require_code_owner_reviews === true;
    if (codeOwners) {
        missingData.push("code owner rules (not supported yet)");
    }
    return { requirements, missingData, notes };
}
export async function defaultBranch(gh, owner, repo) {
    return (await gh.get(`/repos/${owner}/${repo}`)).default_branch;
}
export async function openPulls(gh, owner, repo, limit) {
    const per = Math.min(Math.max(limit, 1), 100);
    return gh.get(`/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=${per}`);
}
/** Login of whoever owns the token. */
export async function viewerLogin(gh) {
    return (await gh.get("/user")).login;
}
/** The open pull request whose head is `branch` in the same repository, or null. */
export async function pullForBranch(gh, owner, repo, branch) {
    const head = encodeURIComponent(`${owner}:${branch}`);
    const found = await gh.get(`/repos/${owner}/${repo}/pulls?state=open&head=${head}&per_page=1`);
    return found[0]?.number ?? null;
}
/** Age of the head commit, from its committer date. Left out when the date is not in the list. */
function headAge(commits, head, now) {
    const date = commits.find((c) => c.sha === head)?.commit?.committer?.date;
    const ms = date ? now.getTime() - Date.parse(date) : NaN;
    return Number.isFinite(ms) ? { headAgeSeconds: Math.max(0, ms / 1000) } : {};
}
export async function readPullRequest(gh, ref, now = new Date()) {
    const repo = `/repos/${ref.owner}/${ref.repo}`;
    const missingData = [];
    const notes = [];
    const pull = await gh.get(`${repo}/pulls/${ref.number}`);
    const [branchRules, commits, reviews] = await Promise.all([
        readBranchRules(gh, ref.owner, ref.repo, pull.base.ref),
        gh.get(`${repo}/pulls/${ref.number}/commits?per_page=100`),
        gh.get(`${repo}/pulls/${ref.number}/reviews?per_page=100`),
    ]);
    const { requirements } = branchRules;
    missingData.push(...branchRules.missingData);
    notes.push(...branchRules.notes);
    // Head first, then a few earlier commits, to recognise results that belong to older pushes.
    const shas = [pull.head.sha, ...commits.map((c) => c.sha).filter((s) => s !== pull.head.sha).slice(-OLDER_COMMITS)];
    const checks = [];
    for (const sha of shas) {
        const [runs, statuses] = await Promise.all([
            gh.get(`${repo}/commits/${sha}/check-runs?per_page=100`),
            gh.get(`${repo}/commits/${sha}/statuses?per_page=100`),
        ]);
        checks.push(...runs.check_runs.map(toCheckEvidence), ...latestStatuses(statuses, sha));
    }
    const author = pull.user?.login ?? "";
    const reviewers = [...new Set(reviews.map((r) => r.user?.login).filter((l) => !!l && l !== author))];
    const access = new Map();
    await Promise.all(reviewers.map(async (login) => {
        // Readable only with push access to the repository; otherwise access stays unknown.
        const p = await gh.tryGet(`${repo}/collaborators/${encodeURIComponent(login)}/permission`);
        access.set(login, p ? ["admin", "maintain", "write"].includes(p.permission) : undefined);
    }));
    if (reviewers.some((l) => access.get(l) === undefined)) {
        notes.push("Write access of some reviewers could not be confirmed, so their approvals do not count.");
    }
    const reviewEvidence = reviews
        .filter((r) => r.user && ["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"].includes(r.state))
        .map((r) => {
        const known = access.get(r.user?.login ?? "");
        return {
            id: `review:${r.id}`,
            reviewer: r.user?.login ?? "",
            state: r.state,
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
            ...headAge(commits, pull.head.sha, now),
        },
        requirements,
        checks,
        reviews: reviewEvidence,
        missingData,
        notes,
    };
}
