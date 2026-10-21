// GitHub rejects check run summaries above 65535 characters.
const MAX_SUMMARY = 60_000;
const MAX_FIELD = 200;
/**
 * Text that came from a repository (check names, logins, file patterns) is untrusted:
 * it could break the table, fake a link or ping people. Escape it and cap its length.
 */
export function escapeUntrusted(text) {
    const oneLine = text.replace(/[\r\n\t]+/g, " ");
    const capped = oneLine.length > MAX_FIELD ? `${oneLine.slice(0, MAX_FIELD - 1)}…` : oneLine;
    return capped
        .replace(/[\\`*_{}[\]()<>#+!|~]/g, (c) => `\\${c}`)
        .replace(/@/g, "@​"); // zero-width space: shows "@name" without mentioning anyone
}
const ICON = {
    met: "✅",
    pending: "⏳",
    failed: "❌",
    missing: "❔",
};
const TITLE = {
    ready: "Ready to merge",
    blocked: "Blocked",
    pending: "Waiting",
    unknown: "Unknown",
};
function who(r) {
    if (r.actor.kind === "nobody")
        return "—";
    const names = (r.actor.who ?? []).map(escapeUntrusted);
    return names.length > 0 ? `${r.actor.kind}: ${names.join(", ")}` : r.actor.kind;
}
function safeUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === "https:" ? u.toString() : null;
    }
    catch {
        return null;
    }
}
/** Title and Markdown summary for the "PRotocol / readiness" check run. */
export function renderCheckRun(evaluation) {
    const failed = evaluation.results.filter((r) => r.status === "failed").length;
    const waiting = evaluation.results.filter((r) => r.status === "pending" || r.status === "missing").length;
    const counts = evaluation.verdict === "blocked"
        ? `: ${failed} failing`
        : evaluation.verdict === "pending"
            ? `: ${waiting} waiting`
            : "";
    const title = `${TITLE[evaluation.verdict]}${counts}`;
    const lines = [
        `**${title}** for commit \`${evaluation.headSha.slice(0, 7)}\` against \`${evaluation.baseSha.slice(0, 7)}\`.`,
        "",
    ];
    if (evaluation.results.length > 0) {
        lines.push("| | Requirement | Who acts | Details |", "|---|---|---|---|");
        const order = { failed: 0, missing: 1, pending: 2, met: 3 };
        const rows = [...evaluation.results].sort((a, b) => order[a.status] - order[b.status]);
        for (const r of rows) {
            const links = r.evidenceUrls
                .map(safeUrl)
                .filter((u) => u !== null)
                .map((u, i) => `[${i === 0 ? "evidence" : i + 1}](${u})`)
                .join(" ");
            lines.push(`| ${ICON[r.status]} | ${escapeUntrusted(r.label)} | ${who(r)} | ${escapeUntrusted(r.explanation)}${links ? ` ${links}` : ""} |`);
        }
    }
    if (evaluation.notes.length > 0) {
        lines.push("", ...evaluation.notes.map((n) => `- ${escapeUntrusted(n)}`));
    }
    lines.push("", "_PRotocol only reads. GitHub's branch rules decide whether the merge button works._");
    let summary = lines.join("\n");
    if (summary.length > MAX_SUMMARY)
        summary = `${summary.slice(0, MAX_SUMMARY)}\n\n_(truncated)_`;
    return { title, summary };
}
