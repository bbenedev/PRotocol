#!/usr/bin/env node
// protocol check owner/repo#123 — evaluates one real pull request from the terminal.

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate } from "./evaluator/evaluate.ts";
import type { Evaluation, RequirementResult, Verdict } from "./evaluator/types.ts";
import { GitHubError, createClient } from "./github/api.ts";
import { parsePullRef, readPullRequest } from "./github/read.ts";

// Exit codes let scripts and CI use the verdict directly.
export const EXIT: Record<Verdict, number> = { ready: 0, blocked: 1, pending: 2, unknown: 3 };
const USAGE_ERROR = 64;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number, text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const VERDICT_STYLE: Record<Verdict, [number, string]> = {
  ready: [32, "READY"],
  blocked: [31, "BLOCKED"],
  pending: [33, "WAITING"],
  unknown: [90, "UNKNOWN"],
};
const MARK: Record<RequirementResult["status"], string> = {
  met: paint(32, "✔"),
  pending: paint(33, "…"),
  failed: paint(31, "✘"),
  missing: paint(33, "?"),
};

// Terminal output must not let repository text send escape sequences to the terminal.
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");

export function renderTerminal(e: Evaluation, title: string): string {
  const [code, word] = VERDICT_STYLE[e.verdict];
  const lines = [`${paint(1, clean(title))}`, `${paint(code, paint(1, word))}  head ${e.headSha.slice(0, 7)}  base ${e.baseSha.slice(0, 7)}`, ""];
  const order = { failed: 0, missing: 1, pending: 2, met: 3 } as const;
  for (const r of [...e.results].sort((a, b) => order[a.status] - order[b.status])) {
    const who = r.actor.kind === "nobody" ? "" : paint(90, `  → ${r.actor.kind}${r.actor.who?.length ? `: ${r.actor.who.join(", ")}` : ""}`);
    lines.push(`${MARK[r.status]} ${clean(r.label)}${who}`);
    lines.push(`  ${clean(r.explanation)}`);
    if (r.evidenceUrls[0]) lines.push(`  ${paint(90, clean(r.evidenceUrls[0]))}`);
  }
  if (e.results.length === 0 && e.notes.length === 0) lines.push("Nothing to evaluate.");
  if (e.notes.length > 0) {
    lines.push("", ...e.notes.map((n) => paint(90, `note: ${clean(n)}`)));
  }
  return lines.join("\n");
}

const HELP = `Usage: protocol check <owner/repo#number | pull request URL> [--json]

Reads one pull request and explains whether it can be merged and who has to act.
Read-only: it never writes to GitHub.

Environment:
  GITHUB_TOKEN   optional; needed for private repositories and a higher rate limit
                 (with the GitHub CLI: GITHUB_TOKEN=$(gh auth token))

Exit codes: 0 ready, 1 blocked, 2 waiting, 3 unknown, 64 usage error.`;

export async function main(argv: string[]): Promise<number> {
  const [command, target, ...rest] = argv;
  if (command !== "check" || !target || rest.some((a) => a !== "--json")) {
    console.error(HELP);
    return USAGE_ERROR;
  }
  const ref = parsePullRef(target);
  if (!ref) {
    console.error(`Not a pull request reference: ${target}\n\n${HELP}`);
    return USAGE_ERROR;
  }
  try {
    const input = await readPullRequest(createClient(process.env.GITHUB_TOKEN), ref);
    const evaluation = evaluate(input);
    if (rest.includes("--json")) console.log(JSON.stringify(evaluation, null, 2));
    else console.log(renderTerminal(evaluation, `${ref.owner}/${ref.repo}#${ref.number}`));
    return EXIT[evaluation.verdict];
  } catch (err) {
    if (err instanceof GitHubError) {
      console.error(`Error: ${err.message}`);
      return EXIT.unknown;
    }
    throw err;
  }
}

// Run only when executed directly, not when imported by the tests.
const invoked = process.argv[1] ? realpathSync(resolve(process.argv[1])) : "";
if (invoked === realpathSync(import.meta.filename)) {
  process.exitCode = await main(process.argv.slice(2));
}
