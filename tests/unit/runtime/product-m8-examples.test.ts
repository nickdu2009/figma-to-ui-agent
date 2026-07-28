import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  m7ExitCode,
  m7RunErrorCategorySchema,
  m7RunResultSchema,
} from "../../../src/runtime/e2e-flow-contracts.ts";

const FIXTURE_DIR = "tests/fixtures/product-m8";

const TOKEN_PATTERNS = [
  /\bfigd_[A-Za-z0-9_-]{8,}\b/,
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /OPENAI_API_KEY\s*=\s*[A-Za-z0-9_-]+/,
];

async function loadFixtureNames(): Promise<string[]> {
  const entries = await readdir(FIXTURE_DIR);
  return entries.filter((name) => name.endsWith(".json"));
}

const expectedExitCodes: Record<string, number> = {
  "local-success.json": 0,
  "restricted-live-success.json": 0,
  "input-invalid.json": 2,
  "auth-missing.json": 3,
  "figma-permission-denied.json": 3,
  "figma-not-found.json": 3,
  "figma-rate-limited.json": 4,
};

describe("Product-M8 fixtures", () => {
  it("every fixture parses against m7RunResultSchema and has expected exit code", async () => {
    const names = await loadFixtureNames();
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const raw = await readFile(`${FIXTURE_DIR}/${name}`, "utf8");
      const parsed = JSON.parse(raw);
      const result = m7RunResultSchema.parse(parsed);
      expect(result).toBeDefined();
      expect(m7ExitCode(result)).toBe(
        expectedExitCodes[name] ??
          (result.ok ? 0 : 1),
      );
    }
  });

  it("fixtures do not contain token or secret values", async () => {
    const names = await loadFixtureNames();
    for (const name of names) {
      const raw = await readFile(`${FIXTURE_DIR}/${name}`, "utf8");
      for (const pattern of TOKEN_PATTERNS) {
        expect(raw).not.toMatch(pattern);
      }
    }
  });
});

type RetryPolicy = "do_not_retry" | "retry_after_fix" | "retry_after_wait" | "manual_review";

interface AgentDecision {
  retryPolicy: RetryPolicy;
  action: string;
}

const agentDecisionTable: Record<string, AgentDecision> = {
  input_invalid: {
    retryPolicy: "retry_after_fix",
    action: "修正 figmaUrl、fileKey、nodeId、projectId、mode 或 designBundleRevision 后重试。",
  },
  auth_missing: {
    retryPolicy: "retry_after_fix",
    action: "检查环境变量 FIGMA_API_KEY 或 CLI gate；补齐后重试，或改用 local 模式。",
  },
  figma_permission_denied: {
    retryPolicy: "retry_after_fix",
    action: "检查 Figma token 权限和文件访问权限后重试。",
  },
  figma_rate_limited: {
    retryPolicy: "retry_after_wait",
    action: "等待 Retry-After 或指数退避后重试；降低并发请求频率。",
  },
  figma_not_found: {
    retryPolicy: "retry_after_fix",
    action: "核对 Figma URL、fileKey、nodeId 或 token 可访问的文件权限后重试。",
  },
  bundle_generation_failed: {
    retryPolicy: "manual_review",
    action: "检查本地 ProjectStore 中是否存在对应 projectId 和 DesignBundle revision；修正后重试。",
  },
  static_generation_partial: {
    retryPolicy: "manual_review",
    action: "查看 summary 中的 warnings/unsupported，补齐缺失能力后重跑 M7。",
  },
  render_compare_failed: {
    retryPolicy: "manual_review",
    action: "查看 validation artifact 和 diff，修复视觉或渲染问题后重跑。",
  },
  validation_failed: {
    retryPolicy: "manual_review",
    action: "查看 validation artifact 和 diff，修复视觉或渲染问题后重跑。",
  },
  internal_error: {
    retryPolicy: "do_not_retry",
    action: "查看 summary.md 和 step trace，定位实现缺陷；不可自动重试，需人工介入或修复代码。",
  },
};

describe("Product-M8 agent decision table", () => {
  it("covers every M7RunErrorCategory", () => {
    const categories = m7RunErrorCategorySchema.options;
    for (const category of categories) {
      const decision = agentDecisionTable[category];
      expect(decision).toBeDefined();
      expect(decision.action.length).toBeGreaterThan(0);
      expect(decision.retryPolicy).toMatch(/^(do_not_retry|retry_after_fix|retry_after_wait|manual_review)$/);
    }
  });
});
