import type { Evaluation, Requirement, RequirementResult, Verdict } from "../evaluator/types.ts";

export type Paint = (code: number, text: string) => string;
export const plain: Paint = (_code, text) => text;
export const ansi: Paint = (code, text) => `\x1b[${code}m${text}\x1b[0m`;

// Repository text must not be able to send escape sequences to the terminal.
export const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");

const VERDICT: Record<Verdict, [number, string]> = {
  ready: [32, "READY"],
  blocked: [31, "BLOCKED"],
  pending: [33, "WAITING"],
  unknown: [90, "UNKNOWN"],
};
const MARK: Record<RequirementResult["status"], [number, string]> = {
  met: [32, "✔"],
  pending: [33, "…"],
  failed: [31, "✘"],
  missing: [33, "?"],
};
const ORDER = { failed: 0, missing: 1, pending: 2, met: 3 } as const;

export function verdictWord(v: Verdict, paint: Paint): string {
  const [code, word] = VERDICT[v];
  return paint(code, word.padEnd(7));
}

export function renderEvaluation(e: Evaluation, title: string, paint: Paint): string {
  const lines = [paint(1, clean(title)), `${paint(1, verdictWord(e.verdict, paint).trimEnd())}  head ${e.headSha.slice(0, 7)}  base ${e.baseSha.slice(0, 7)}`, ""];
  for (const r of [...e.results].sort((a, b) => ORDER[a.status] - ORDER[b.status])) {
    const [code, mark] = MARK[r.status];
    const who =
      r.actor.kind === "nobody" ? "" : paint(90, `  → ${r.actor.kind}${r.actor.who?.length ? `: ${clean(r.actor.who.join(", "))}` : ""}`);
    lines.push(`${paint(code, mark)} ${clean(r.label)}${who}`, `  ${clean(r.explanation)}`);
    if (r.evidenceUrls[0]) lines.push(`  ${paint(90, clean(r.evidenceUrls[0]))}`);
  }
  if (e.results.length === 0 && e.notes.length === 0) lines.push("Nothing to evaluate.");
  if (e.notes.length > 0) lines.push("", ...e.notes.map((n) => paint(90, `note: ${clean(n)}`)));
  return lines.join("\n");
}

// Rules only give an app id; name the one almost every repository uses.
const KNOWN_APPS: Record<number, string> = { 15368: "GitHub Actions" };

export function describeRequirement(r: Requirement): string {
  switch (r.kind) {
    case "check": {
      const app = r.appId ? ` from ${KNOWN_APPS[r.appId] ?? `app ${r.appId}`}` : "";
      return `check "${clean(r.context)}"${app}${r.strict ? ", branch must be up to date" : ""}`;
    }
    case "approvals":
      return `${r.count} approving review${r.count === 1 ? "" : "s"}${r.requireCurrentHead ? ", dismissed on new pushes" : ""}`;
    case "codeowners":
      return "approval from code owners";
    case "last-push-approval":
      return "approval of the latest push by someone else";
  }
}

export interface ListRow {
  number: number;
  title: string;
  verdict: Verdict;
  actors: string;
}

/**
 * One line per pull request. Columns are as wide as their longest value, and the title is cut
 * with "…" to fit the terminal, so a line never wraps. Without a known width nothing is cut.
 */
export function formatList(rows: ListRow[], paint: Paint, columns?: number): string {
  const numW = Math.max(...rows.map((r) => String(r.number).length)) + 1;
  const actW = Math.max(...rows.map((r) => r.actors.length));
  const fixed = numW + 2 + 7 + 2 + actW + 2;
  const room = columns && columns > fixed + 10 ? columns - fixed - 1 : Infinity;
  return rows
    .map((r) => {
      const title = clean(r.title);
      const cut = title.length > room ? `${title.slice(0, room - 1)}…` : title;
      return `${`#${r.number}`.padEnd(numW)}  ${verdictWord(r.verdict, paint)}  ${r.actors.padEnd(actW)}  ${cut}`;
    })
    .join("\n");
}

/** Who has to act, summarised for one line of `prot list`. */
export function actorsOf(e: Evaluation): string {
  const kinds = new Set<string>();
  for (const r of e.results) if (r.status !== "met" && r.actor.kind !== "nobody") kinds.add(r.actor.kind);
  return [...kinds].join(", ") || "—";
}
