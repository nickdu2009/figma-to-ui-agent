#!/usr/bin/env node
/**
 * DS-GATE-00 / DSG-01：Catalog 合同性与性能基线探针（无真实凭据）。
 *
 * 产出（写入 stdout 的 JSON 摘要）：
 *  1. shadcn 0.19.0 definitions 总数、移除 runtime-owned Link 后的 base 数、
 *     Slot/Link runtime ownership、schema.builtInActions 精确键集合。
 *  2. overlay 机械扩宽可行性：optional-undefined identity、base-first
 *     z.union 扩宽的确定性 JSON Schema 导出（两次构建 digest 相同）、
 *     legacy/preferred 夹具分支命中。
 *  3. 性能基线：完整 catalog JSON Schema 字节、prompt 字节与 token 估算、
 *     catalog 构建/jsonSchema 派生/prompt/validate 耗时、进程峰值 RSS。
 *
 * 运行：node scripts/ds-gate-00/catalog-contract-probe.ts
 * （Node 24 直接剥离 TS 类型；仅依赖仓库既有 node_modules。）
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import process from "node:process";
import { z } from "zod";
import { defineCatalog } from "@json-render/core";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { schema } from "@next-app-runtime/client/schema";

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function nowMs(): number {
  return performance.now();
}

interface GateResult {
  probe: string;
  node: string;
  measuredAt: string;
  ownership?: Record<string, unknown>;
  overlayFeasibility?: Record<string, unknown>;
  performance?: {
    catalogBuildMs?: number;
    jsonSchemaDeriveMs?: number;
    jsonSchemaBytes?: number;
    promptGenerateMs?: number;
    promptBytes?: number;
    promptTokenEstimate?: number;
    validateMs?: number;
    validateOk?: boolean;
    rssBeforeBytes?: number;
    rssAfterBytes?: number;
    rssGrowthBytes?: number;
    jsonSchemaSha256?: string;
    viteBuildMs?: number | null;
    viteBuildError?: string;
  };
}

const result: GateResult = {
  probe: "ds-gate-00/catalog-contract-probe",
  node: process.version,
  measuredAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// 1) 单一组合边界事实
// ---------------------------------------------------------------------------
const definitionKeys = Object.keys(shadcnComponentDefinitions);
const { Link: _runtimeOwnedLink, ...baseComponentDefinitions } =
  shadcnComponentDefinitions;
const baseKeys = Object.keys(baseComponentDefinitions);

const builtInActions = (schema.builtInActions ?? []).map(
  (action: { name: string }) => action.name,
);

result.ownership = {
  shadcnDefinitionCount: definitionKeys.length,
  baseCountAfterSingleLinkRemoval: baseKeys.length,
  linkPresentInShadcn: "Link" in shadcnComponentDefinitions,
  slotPresentInShadcn: "Slot" in shadcnComponentDefinitions,
  builtInActionNames: [...builtInActions].sort(),
  builtInActionCount: builtInActions.length,
};
if (definitionKeys.length !== 36 || baseKeys.length !== 35) {
  console.error(
    `[catalog-probe] FAIL: expected 36 definitions / 35 after Link removal, got ${definitionKeys.length}/${baseKeys.length}`,
  );
  process.exitCode = 1;
}
if (
  builtInActions.length !== 4 ||
  !["navigate", "pushState", "removeState", "setState"].every((name) =>
    builtInActions.includes(name),
  )
) {
  console.error(
    "[catalog-probe] FAIL: builtInActions mismatch",
    builtInActions,
  );
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// 2) overlay 机械扩宽可行性（S1 的前置机械性假设）
// ---------------------------------------------------------------------------
// 2a. optional-undefined identity：Prop addition 必须是
//     safeParse(undefined) 成功且 data === undefined 的纯 Schema。
const optionalAddition = z.string().optional();
const optionalParse = optionalAddition.safeParse(undefined);
const optionalIdentity =
  optionalParse.success && optionalParse.data === undefined;

// 2b. base-first 机械扩宽：z.union([base, preferred]) 的确定性 JSON Schema。
const selectOptionBase = z.string();
const selectOptionPreferred = z.object({
  label: z.string(),
  value: z.string(),
  description: z.string().optional(),
  disabled: z.boolean().optional(),
});
const widenedOnce = z.union([selectOptionBase, selectOptionPreferred]);
const widenedTwice = z.union([
  z.string(),
  z.object({
    label: z.string(),
    value: z.string(),
    description: z.string().optional(),
    disabled: z.boolean().optional(),
  }),
]);
const schemaOnce = JSON.stringify(z.toJSONSchema(widenedOnce));
const schemaTwice = JSON.stringify(z.toJSONSchema(widenedTwice));
const wideningDeterministic = schemaOnce === schemaTwice;

// 2c. legacy/preferred 夹具分支：legacy 字符串命中 base 分支，
//     preferred 对象命中新分支，均通过同一 widened Schema。
const legacyFixture = "Option A";
const preferredFixture = {
  label: "Option A",
  value: "option-a",
  description: "The first option",
  disabled: false,
};
const legacyOk = widenedOnce.safeParse(legacyFixture);
const preferredOk = widenedOnce.safeParse(preferredFixture);

// 2d. effect 禁止样例验证：catch/coerce/default 类 Schema 在本探针中
//     只证明“我们可以在 S1 构建期以静态规则拒绝”，这里不构造它们。
result.overlayFeasibility = {
  optionalUndefinedIdentity: optionalIdentity,
  wideningDeterministic,
  widenedJsonSchemaBytes: Buffer.byteLength(schemaOnce, "utf8"),
  widenedJsonSchemaSha256: sha256(schemaOnce),
  legacyFixtureHitsBase: legacyOk.success,
  preferredFixtureHitsPreferred: preferredOk.success,
};
if (
  !optionalIdentity ||
  !wideningDeterministic ||
  !legacyOk.success ||
  !preferredOk.success
) {
  console.error(
    "[catalog-probe] FAIL: overlay mechanical assumptions not satisfied",
    result.overlayFeasibility,
  );
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// 3) 性能基线（当前 35 组件 catalog，P0 扩展前的批准基线）
// ---------------------------------------------------------------------------
function measure<T>(fn: () => T): { ms: number; value: T } {
  const start = nowMs();
  const value = fn();
  return { ms: nowMs() - start, value };
}

const rssBefore = process.memoryUsage().rss;

const build = measure(() =>
  defineCatalog(schema, {
    components: baseComponentDefinitions,
    actions: {},
  }),
);
const catalog = build.value;

const jsonSchema = measure(() => JSON.stringify(catalog.jsonSchema()));
const prompt = measure(() => catalog.prompt());
const minimalSpec = {
  metadata: {
    title: { default: "Probe", template: "%s | Probe" },
  },
  routes: {},
};
const validate = measure(() => catalog.validate(minimalSpec));

const rssAfter = process.memoryUsage().rss;

// 简单 token 估算：英文 JSON/文本 ~4 bytes/token（与 DS-GATE-00 记录口径一致）。
const promptBytes = Buffer.byteLength(prompt.value, "utf8");
const promptTokenEstimate = Math.ceil(promptBytes / 4);

result.performance = {
  catalogBuildMs: Number(build.ms.toFixed(2)),
  jsonSchemaDeriveMs: Number(jsonSchema.ms.toFixed(2)),
  jsonSchemaBytes: Buffer.byteLength(jsonSchema.value, "utf8"),
  promptGenerateMs: Number(prompt.ms.toFixed(2)),
  promptBytes,
  promptTokenEstimate,
  validateMs: Number(validate.ms.toFixed(2)),
  validateOk: validate.value.success,
  rssBeforeBytes: rssBefore,
  rssAfterBytes: rssAfter,
  rssGrowthBytes: rssAfter - rssBefore,
  jsonSchemaSha256: sha256(jsonSchema.value),
};

// ---------------------------------------------------------------------------
// 4) vite 全量构建耗时（子进程计时；不改变任何源文件）
//    通过环境变量跳过：VMA_GATE_SKIP_BUILD=1（仅调试用）。
// ---------------------------------------------------------------------------
if (process.env.VMA_GATE_SKIP_BUILD !== "1") {
  const perf: NonNullable<GateResult["performance"]> = result.performance ?? {};
  const buildStart = nowMs();
  try {
    execFileSync("npm", ["run", "build"], {
      stdio: "pipe",
      env: { ...process.env },
      timeout: 600_000,
    });
    perf.viteBuildMs = Number((nowMs() - buildStart).toFixed(2));
  } catch {
    perf.viteBuildMs = null;
    perf.viteBuildError = "vite build failed";
    process.exitCode = 1;
  }
  result.performance = perf;
}

console.log(JSON.stringify(result, null, 2));
