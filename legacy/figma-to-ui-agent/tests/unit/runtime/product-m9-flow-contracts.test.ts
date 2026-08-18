import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  productM9AgentDecisionTable,
  productM9ErrorCategorySchema,
  productM9ExitCode,
  productM9RunResultSchema,
} from "../../../src/runtime/product-m9-flow-contracts.ts";

const FIXTURE_DIR = "tests/fixtures/product-m9";

const TOKEN_PATTERNS = [
  /\bfigd_[A-Za-z0-9_-]{8,}\b/,
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /OPENAI_API_KEY\s*=\s*[A-Za-z0-9_-]+/,
  /FIGMA_API_KEY\s*=\s*[A-Za-z0-9_-]+/,
  /https:\/\/www\.figma\.com\/design\//,
  /\/Users\/[^"]+/,
  /\/var\/folders\/[^"]+/,
];

const expectedExitCodes: Record<string, number> = {
  "local-success.json": 0,
  "input-invalid.json": 2,
  "auth-missing.json": 3,
  "figma-permission-denied.json": 3,
  "figma-not-found.json": 3,
  "artifact-missing.json": 3,
  "figma-rate-limited.json": 4,
  "flow-execution-failed.json": 5,
  "needs-confirmation.json": 6,
  "unsupported-figma-action.json": 6,
  "partial-evidence.json": 6,
  "internal-error.json": 1,
};

async function fixtureNames(): Promise<string[]> {
  const entries = await readdir(FIXTURE_DIR);
  return entries.filter((entry) => entry.endsWith(".json")).sort();
}

describe("Product-M9 result contract", () => {
  it("parses every Product-M9 fixture and maps exit codes", async () => {
    const names = await fixtureNames();
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const raw = await readFile(`${FIXTURE_DIR}/${name}`, "utf8");
      const parsed = productM9RunResultSchema.parse(JSON.parse(raw));
      expect(productM9ExitCode(parsed)).toBe(expectedExitCodes[name]);
    }
  });

  it("fixtures do not include secrets, raw Figma URLs, or absolute local paths", async () => {
    for (const name of await fixtureNames()) {
      const raw = await readFile(`${FIXTURE_DIR}/${name}`, "utf8");
      for (const pattern of TOKEN_PATTERNS) {
        expect(raw).not.toMatch(pattern);
      }
    }
  });

  it("agent decision table covers every Product-M9 error category", () => {
    for (const category of productM9ErrorCategorySchema.options) {
      const decision = productM9AgentDecisionTable[category];
      expect(decision).toBeDefined();
      expect(decision.nextAction.length).toBeGreaterThan(0);
      expect(decision.retryPolicy).toMatch(
        /^(do_not_retry|retry_after_fix|retry_after_wait|manual_review)$/,
      );
    }
  });
});
