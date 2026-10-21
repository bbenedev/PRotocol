// GitHub treats these as passing for a required check.
const PASSING = new Set(["success", "neutral", "skipped"]);
const short = (sha) => sha.slice(0, 7);
function newestFirst(a, b) {
    return b.startedAt.localeCompare(a.startedAt);
}
function freshnessOf(check, pr) {
    if (check.baseSha === undefined)
        return "base-unknown";
    return check.baseSha === pr.baseSha ? "current" : "old-base";
}
/** Evaluate one required check against every check and status reported for the pull request. */
export function evaluateCheck(req, checks, pr) {
    const id = `check:${req.context}`;
    const label = `Check "${req.context}"`;
    const named = checks.filter((c) => c.name === req.context);
    const fromRightApp = named.filter((c) => req.appId === undefined || c.appId === req.appId);
    if (fromRightApp.length === 0) {
        if (named.length > 0) {
            const apps = [...new Set(named.map((c) => c.appName ?? `app ${c.appId ?? "unknown"}`))];
            return {
                id,
                label,
                status: "missing",
                actor: { kind: "maintainer" },
                explanation: `A check with this name exists, but it was published by ${apps.join(", ")}, ` +
                    `not by the app the branch rules require. It does not count.`,
                evidenceUrls: named.flatMap((c) => (c.url ? [c.url] : [])),
            };
        }
        return {
            id,
            label,
            status: "missing",
            actor: { kind: "maintainer" },
            explanation: "No result for this check has been reported on any commit of this pull request. " +
                "Check that the workflow runs on pull requests and is not skipped by a path filter.",
            evidenceUrls: [],
        };
    }
    const onHead = fromRightApp.filter((c) => c.commitSha === pr.headSha).sort(newestFirst);
    const latest = onHead[0];
    if (latest === undefined) {
        const older = [...fromRightApp].sort(newestFirst)[0];
        return {
            id,
            label,
            status: "pending",
            freshness: "old-head",
            actor: { kind: "ci" },
            explanation: `The latest result is for commit ${short(older?.commitSha ?? "")}, ` +
                `not the current head ${short(pr.headSha)}. Waiting for a run on the current commit.`,
            evidenceUrls: older?.url ? [older.url] : [],
        };
    }
    const urls = latest.url ? [latest.url] : [];
    if (latest.status !== "completed") {
        return {
            id,
            label,
            status: "pending",
            freshness: freshnessOf(latest, pr),
            actor: { kind: "ci" },
            explanation: latest.status === "queued" ? "Queued." : "Not finished yet.",
            evidenceUrls: urls,
        };
    }
    if (latest.conclusion === "stale" || latest.conclusion === undefined) {
        return {
            id,
            label,
            status: "pending",
            actor: { kind: "ci" },
            explanation: "GitHub marked this result as stale. It needs to run again.",
            evidenceUrls: urls,
        };
    }
    if (!PASSING.has(latest.conclusion)) {
        return {
            id,
            label,
            status: "failed",
            freshness: freshnessOf(latest, pr),
            actor: { kind: "author" },
            explanation: `Finished with "${latest.conclusion}" on the current commit. Open the log, fix it and push.`,
            evidenceUrls: urls,
        };
    }
    const freshness = freshnessOf(latest, pr);
    if (freshness === "old-base" && req.strict === true) {
        return {
            id,
            label,
            status: "pending",
            freshness,
            actor: { kind: "author" },
            explanation: `Passed, but against base ${short(latest.baseSha ?? "")} and the base is now ` +
                `${short(pr.baseSha)}. The branch rules require testing against the current base: update the branch.`,
            evidenceUrls: urls,
        };
    }
    const extra = freshness === "old-base"
        ? ` It ran against an older base (${short(latest.baseSha ?? "")}); GitHub accepts it, but the base has changed since.`
        : ""; // an unknown base is reported once, in the evaluation notes
    return {
        id,
        label,
        status: "met",
        freshness,
        actor: { kind: "nobody" },
        explanation: `Passed on the current commit.${extra}`,
        evidenceUrls: urls,
    };
}
