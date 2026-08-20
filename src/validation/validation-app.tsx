/**
 * __validation 页面应用（设计 §11.5，计划 S9 动作 2）。
 *
 * 渲染 worker 注入的单个 case（route × viewport）：
 * - Runtime 以 validation phase + 确定性 fixture adapter 创建（数据读返回
 *   由 businessSchema 派生的确定性夹具；写/导出 fail closed；ui 本地 no-op；
 *   绝不调用真实 Hono 业务路由）；
 * - Token/CSS 经 S6 编译器编译（作用域 [data-vma-validation-root]）后
 *   命令式注入 <style>；资产经 /__validation-asset/<assetId> 同源路径
 *   请求（worker 代取，页面不持有 capability）；
 * - 首次提交后设置 window.__VALIDATION_RENDERED__（done/empty/failed:*），
 *   worker 据此采集指标或判定渲染失败。
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  createRuntimeWithNavigation,
  NextAppRenderer,
  NextAppRuntimeProvider,
  type RuntimeActionAdapter,
  type RuntimeActionContract,
  type RuntimeActionHandler,
  type RuntimeActionResult,
} from "@next-app-runtime/client";
import { catalog, registry } from "../runtime/catalog.tsx";
import { createPreviewNavigation } from "../runtime/preview-navigation.ts";
import { compileTokens } from "../runtime/token-compiler.ts";
import { compileApplicationCss } from "../runtime/css-compiler.ts";
import {
  actionStateTargetsSchema,
  p0CustomActions,
} from "../catalog/action-contracts.ts";

interface ValidationBootstrap {
  bundle: {
    spec: unknown;
    designSystem?: {
      tokens?: unknown;
      applicationCss?: string;
    };
    assets?: { entries?: Array<{ assetId: string }> };
  };
  businessSchema: {
    collections?: Array<{
      key: string;
      fields: Array<{
        key: string;
        type: string;
        enumValues?: string[];
      }>;
    }>;
  } | null;
  route: string;
  params: Record<string, string> | null;
}

function parseBootstrap(raw: unknown): ValidationBootstrap {
  const candidate = raw as Partial<ValidationBootstrap> | null;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !candidate.bundle ||
    typeof candidate.route !== "string"
  ) {
    throw new Error("bootstrap_invalid");
  }
  return candidate as ValidationBootstrap;
}

/** 动态路由 [param] 段以 staticParams 具体化。 */
function concretePathname(route: string, params: Record<string, string> | null): string {
  if (!params) return route;
  return route
    .split("/")
    .map((segment) => {
      if (segment.startsWith("[") && segment.endsWith("]")) {
        return params[segment.slice(1, -1)] ?? segment;
      }
      return segment;
    })
    .join("/");
}

/** 确定性夹具行：字段键 → 按类型的确定性样本值。 */
function fixtureValue(
  field: { key: string; type: string; enumValues?: string[] },
  rowIndex: number,
): unknown {
  switch (field.type) {
    case "number":
      return rowIndex + 1;
    case "boolean":
      return rowIndex % 2 === 0;
    case "date":
      return "2026-01-01";
    case "enum":
      return field.enumValues?.[0] ?? "sample";
    default:
      return `示例${field.key}${rowIndex + 1}`;
  }
}

function buildFixtureRows(
  businessSchema: ValidationBootstrap["businessSchema"],
  collectionKey: string,
): Array<{ recordId: string; revision: number; data: Record<string, unknown> }> {
  const collection = businessSchema?.collections?.find(
    (candidate) => candidate.key === collectionKey,
  );
  if (!collection) return [];
  const rows = [];
  for (let index = 0; index < 3; index++) {
    const data: Record<string, unknown> = {};
    for (const field of collection.fields) {
      data[field.key] = fixtureValue(field, index);
    }
    rows.push({
      recordId: `fixture-${collectionKey}-${index + 1}`,
      revision: 1,
      data,
    });
  }
  return rows;
}

/** validation phase 的确定性 fixture Adapter（零真实网络）。 */
function createValidationFixtureAdapter(
  bootstrap: ValidationBootstrap,
): RuntimeActionAdapter {
  const handlers: Record<string, RuntimeActionHandler> = {};
  const contracts: Record<string, RuntimeActionContract> = {};
  for (const [name, action] of Object.entries(p0CustomActions)) {
    contracts[name] = {
      validateParams: (params) => {
        const parsed = action.params.safeParse(params);
        if (parsed.success) {
          return { ok: true, value: parsed.data as Record<string, unknown> };
        }
        return { ok: false, code: "action_params_invalid" as const };
      },
      validateTargets: (targets) => {
        const parsed = actionStateTargetsSchema.safeParse(targets);
        if (parsed.success) return { ok: true, value: { ...parsed.data } };
        return { ok: false, code: "action_targets_invalid" as const };
      },
      permissionClass: action.permissionClass,
      concurrency:
        action.permissionClass === "record-read" ? "latest-wins" : "exclusive",
    };
    handlers[name] = (input): Promise<RuntimeActionResult> => {
      const fail = (code: string, message: string): RuntimeActionResult => ({
        status: "error",
        dispatchId: input.dispatchId,
        error: { code, message },
      });
      if (name === "queryRecords") {
        const collectionKey = String(
          (input.params as { collectionKey?: unknown }).collectionKey ?? "",
        );
        return Promise.resolve({
          status: "success",
          dispatchId: input.dispatchId,
          serverRequestId: "validation-fixture",
          data: {
            items: buildFixtureRows(bootstrap.businessSchema, collectionKey),
            nextCursor: null,
          },
        });
      }
      if (name === "loadRecordForm") {
        const collectionKey = String(
          (input.params as { collectionKey?: unknown }).collectionKey ?? "",
        );
        const first = buildFixtureRows(bootstrap.businessSchema, collectionKey)[0];
        if (!first) {
          return Promise.resolve(
            fail("record_not_found", "夹具集合无记录"),
          );
        }
        return Promise.resolve({
          status: "success",
          dispatchId: input.dispatchId,
          serverRequestId: "validation-fixture",
          data: first,
        });
      }
      if (
        name === "openDialog" ||
        name === "closeDialog" ||
        name === "showToast"
      ) {
        return Promise.resolve({
          status: "success",
          dispatchId: input.dispatchId,
          serverRequestId: "validation-fixture",
          data: { fixture: true },
        });
      }
      // 写/导出：validation phase 稳定拒绝（零网络）
      return Promise.resolve(
        fail("action_forbidden", "validation 阶段禁止写/导出"),
      );
    };
  }
  return Object.freeze({
    protocolVersion: 1 as const,
    handlers: Object.freeze(handlers),
    contracts: Object.freeze(contracts),
    hostEffects: {
      platformUi: {
        navigate: () => {},
        openDialog: () => {},
        closeDialog: () => {},
        showToast: () => {},
      },
    },
  });
}

export function ValidationApp(props: {
  bootstrap: unknown;
  onRendered: (flag: string) => void;
}) {
  const { onRendered } = props;
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: parseBootstrap(props.bootstrap) };
    } catch {
      return { ok: false as const };
    }
  }, [props.bootstrap]);

  const handle = useMemo(() => {
    if (!parsed.ok) return null;
    const bootstrap = parsed.value;
    const pathname = concretePathname(bootstrap.route, bootstrap.params);
    const navigation = createPreviewNavigation(pathname);
    const actionAdapter = createValidationFixtureAdapter(bootstrap);
    const runtime = createRuntimeWithNavigation(
      {
        catalog,
        registry,
        limits: {
          maxBytes: 2_500_000,
          maxOperations: 1_000,
          maxDepth: 100,
          maxRoutes: 100,
          maxElementsPerTree: 1_000,
        },
        fallbacks: {
          loading: () => null,
          error: () => null,
          notFound: () => null,
          unmatched: () => null,
        },
        actionAdapter,
        actionExecutionContext: {
          phase: "validation" as const,
          identity: {
            appId: "validation",
            candidateDigest: "validation",
            bundleRevision: 1,
          },
        },
        initialSource: { kind: "object" as const, value: bootstrap.bundle.spec },
      },
      navigation,
    );
    // S6 编译面：Token/CSS（validation 作用域；失败即渲染失败）。
    // token customProperties 由 css-compiler 内嵌进 compiled.cssText。
    let designCss: string | null = null;
    try {
      const designSystem = bootstrap.bundle.designSystem;
      if (designSystem && (designSystem.tokens || designSystem.applicationCss)) {
        const tokens = compileTokens({
          tokens: (designSystem.tokens ?? {}) as never,
          digestPrefix: "validatn",
        });
        const manifestIds = new Set(
          (bootstrap.bundle.assets?.entries ?? []).map((entry) => entry.assetId),
        );
        const compiled = compileApplicationCss({
          applicationCss: designSystem.applicationCss ?? "",
          scopeAttribute: "[data-vma-validation-root]",
          digestPrefix: "validatn",
          tokenCustomProperties: tokens.customProperties,
          manifestAssetIds: manifestIds,
        });
        designCss = compiled.cssText;
      }
    } catch {
      designCss = null;
      return { runtime, navigation, designCss, designFailed: true };
    }
    return { runtime, navigation, designCss, designFailed: false };
  }, [parsed]);

  const snapshot = useSyncExternalStore(
    handle ? handle.runtime.subscribe : () => () => {},
    handle ? handle.runtime.getSnapshot : () => null,
    () => null,
  );

  useEffect(() => {
    if (!parsed.ok || !handle) {
      onRendered("failed:bootstrap");
      return;
    }
    if (handle.designFailed) {
      onRendered("failed:design_compile");
      return;
    }
    if (!snapshot) return;
    if (snapshot.specStatus === "ready") {
      // 等一帧让布局稳定后再标记（worker 另有 50ms 余量）
      const frame = requestAnimationFrame(() => onRendered("done"));
      return () => cancelAnimationFrame(frame);
    }
    if (snapshot.specStatus === "invalid") {
      onRendered("failed:spec_apply");
      return;
    }
    if (snapshot.specStatus === "empty") {
      onRendered("empty");
      return;
    }
    return undefined;
  }, [parsed, handle, snapshot, onRendered]);

  useEffect(
    () => () => {
      handle?.runtime.dispose();
      handle?.navigation.dispose();
    },
    [handle],
  );

  if (!parsed.ok || !handle) {
    return null;
  }
  return (
    <div data-vma-validation-root="">
      {handle.designCss === null ? null : (
        <style data-vma-design-css="">{handle.designCss}</style>
      )}
      <NextAppRuntimeProvider runtime={handle.runtime}>
        <NextAppRenderer />
      </NextAppRuntimeProvider>
    </div>
  );
}
