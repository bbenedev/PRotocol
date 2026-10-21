import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// The evaluator must stay pure: it decides, it never fetches. If someone imports the
// network, the database or Node built-ins with side effects from it, this test fails.
const EVALUATOR = join(import.meta.dirname, "..", "src", "evaluator");
const ALLOWED = /^\.\/[\w-]+\.ts$/;

test("the evaluator only imports its own files", () => {
  const offenders: string[] = [];
  for (const file of readdirSync(EVALUATOR).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(join(EVALUATOR, file), "utf8");
    for (const m of source.matchAll(/(?:import|export)[^"']*?from\s+["']([^"']+)["']|import\(["']([^"']+)["']\)/g)) {
      const target = m[1] ?? m[2] ?? "";
      if (!ALLOWED.test(target)) offenders.push(`${file} -> ${target}`);
    }
  }
  assert.deepEqual(offenders, []);
});
