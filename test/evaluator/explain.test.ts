import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../../src/evaluator/evaluate.ts";
import { escapeUntrusted, renderCheckRun } from "../../src/evaluator/explain.ts";
import type { Evaluation } from "../../src/evaluator/types.ts";
import { check, input } from "./helpers.ts";

test("mentions are neutralised so a check name cannot ping people", () => {
  assert.equal(escapeUntrusted("@everyone"), "@​everyone");
});

test("table and link syntax from untrusted text is escaped", () => {
  const out = escapeUntrusted("x | [click](https://evil.example) <img>");
  assert.ok(!out.includes(" | "));
  assert.ok(out.includes("\\[click\\]"));
  assert.ok(out.includes("\\<img\\>"));
});

test("untrusted text is kept on one line and capped", () => {
  const out = escapeUntrusted(`a\nb${"z".repeat(500)}`);
  assert.ok(!out.includes("\n"));
  assert.ok(out.length <= 210);
});

test("the title states the verdict and how many requirements fail", () => {
  const e = evaluate(
    input({ requirements: [{ kind: "check", context: "ci/test" }], checks: [check({ conclusion: "failure" })] }),
  );
  assert.equal(renderCheckRun(e).title, "Blocked: 1 failing");
});

test("failures are listed before passing requirements, with a link to the evidence", () => {
  const e = evaluate(
    input({
      requirements: [
        { kind: "check", context: "lint" },
        { kind: "check", context: "ci/test" },
      ],
      checks: [check({ name: "lint" }), check({ name: "ci/test", conclusion: "failure", url: "https://github.com/x" })],
    }),
  );
  const { summary } = renderCheckRun(e);
  assert.ok(summary.indexOf("❌") < summary.indexOf("✅"));
  assert.ok(summary.includes("[evidence](https://github.com/x)"));
});

test("only https evidence links are shown", () => {
  const e: Evaluation = {
    verdict: "pending",
    headSha: "a".repeat(40),
    baseSha: "c".repeat(40),
    notes: [],
    results: [
      {
        id: "check:x",
        label: "x",
        status: "pending",
        actor: { kind: "ci" },
        explanation: "Running.",
        evidenceUrls: ["javascript:alert(1)", "http://plain.example", "https://ok.example/"],
      },
    ],
  };
  const { summary } = renderCheckRun(e);
  assert.ok(!summary.includes("javascript:"));
  assert.ok(!summary.includes("http://plain"));
  assert.ok(summary.includes("https://ok.example/"));
});

test("a huge summary is truncated below GitHub's limit", () => {
  const many = Array.from({ length: 2000 }, (_, i) => ({ kind: "check" as const, context: `check-${i}-${"x".repeat(40)}` }));
  const { summary } = renderCheckRun(evaluate(input({ requirements: many })));
  assert.ok(summary.length < 65_535);
  assert.ok(summary.endsWith("_(truncated)_"));
});
