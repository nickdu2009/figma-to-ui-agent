/**
 * BundlePreviewController 契约测试（S4，设计 §5.1.1）：
 * - 候选 Runtime 唯一 applySource、smoke、原子切换（active 一次替换）；
 * - 故障注入：摘要错配、apply 失败、初始化超时、swap 中断（abort）、
 *   dispose 后回调、旧 finish、重复 finish、并发 staging busy；
 * - 任何失败都保留旧 revision（页面从不观察半套 Runtime）；
 * - staging→unsaved→draft 单调推进与身份核对（confirmDraftCommitted）；
 * - draft/published 装载的执行绑定。
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createRuntimeWithNavigation,
  type NextAppRuntime,
  type RuntimeFallbacks,
  type RuntimeLimits,
} from "@next-app-runtime/client";

import {
  createBundlePreviewController,
  type BundlePreviewController,
  type PreviewRuntimeFactory,
} from "../../src/runtime/bundle-preview-controller.js";
import { createBrowserRuntimeActionAdapter } from "../../src/runtime/runtime-action-adapter.js";
import { catalog, registry } from "../../src/runtime/catalog.js";
import {
  appUiBundleSchema,
  type AppUiBundle,
} from "../../src/catalog/app-ui-bundle.js";
import { digestCanonicalJson } from "../../src/catalog/canonical-json.js";

const APP_ID = "app_preview_test";

const LIMITS: RuntimeLimits = {
  maxBytes: 1_000_000,
  maxOperations: 1_000,
  maxDepth: 100,
  maxRoutes: 100,
  maxElementsPerTree: 1_000,
};

const FALLBACKS: RuntimeFallbacks = {
  loading: () => null,
  error: () => null,
  notFound: () => null,
  unmatched: () => null,
};

const STACK_PROPS = {
  direction: "vertical",
  gap: "md",
  align: null,
  justify: null,
  className: null,
};

/** runtime catalog 可校验通过的完整 spec（props 全字段显式 null）。 */
const VALID_SPEC = {
  metadata: { title: { default: "Acme", template: "%s | Acme" } },
  routes: {
    "/": {
      page: {
        root: "root",
        elements: {
          root: { type: "Stack", props: STACK_PROPS, children: ["t1"] },
          t1: {
            type: "Text",
            props: { text: "首页内容", variant: null },
            children: [],
          },
        },
      },
    },
    "/docs": {
      page: {
        root: "root",
        elements: {
          root: { type: "Stack", props: STACK_PROPS, children: ["d1"] },
          d1: {
            type: "Text",
            props: { text: "文档内容", variant: null },
            children: [],
          },
        },
      },
    },
  },
};

function makeFactory(
  surfaceLog: string[],
  options: {
    dropInitialSource?: boolean;
    corruptInitialSource?: boolean;
  } = {},
): PreviewRuntimeFactory {
  return ({ navigation, executionContext, initialSource }) => {
    const actionAdapter = createBrowserRuntimeActionAdapter({
      appId: APP_ID,
      surface: {
        navigate: (href) => surfaceLog.push(`navigate:${href}`),
        showToast: (input) => surfaceLog.push(`toast:${input.title}`),
        setDialogOpen: (id, open) => surfaceLog.push(`dialog:${id}:${open}`),
      },
      // S4 阶段 catalog 未声明 custom Action；Adapter 键集合与之精确闭合。
      includeActionNames: Object.keys(
        (catalog.data as { actions?: Record<string, unknown> }).actions ?? {},
      ),
    });
    return createRuntimeWithNavigation(
      {
        catalog,
        registry,
        limits: LIMITS,
        fallbacks: FALLBACKS,
        actionAdapter,
        actionExecutionContext: executionContext,
        ...(options.dropInitialSource ? {} : { initialSource }),
        ...(options.corruptInitialSource
          ? {
              initialSource: {
                kind: "object" as const,
                value: {
                  routes: {
                    "/": {
                      page: {
                        root: "r",
                        elements: {
                          r: {
                            type: "NoSuchComponent",
                            props: {},
                            children: [],
                          },
                        },
                      },
                    },
                  },
                },
              },
            }
          : {}),
      },
      navigation,
    );
  };
}

function makeController(
  surfaceLog: string[] = [],
  options: {
    stagingTimeoutMs?: number;
    dropInitialSource?: boolean;
    corruptInitialSource?: boolean;
  } = {},
): {
  controller: BundlePreviewController;
  surfaceLog: string[];
} {
  const log = surfaceLog;
  const controller = createBundlePreviewController({
    appId: APP_ID,
    createPreviewRuntime: makeFactory(log, options),
    ...(options.stagingTimeoutMs === undefined
      ? {}
      : { stagingTimeoutMs: options.stagingTimeoutMs }),
  });
  return { controller, surfaceLog: log };
}

/** base=empty 的完整应用补丁（RFC 6902 JSONL；由 VALID_SPEC 派生）。 */
const CREATE_PATCH = [
  JSON.stringify({
    op: "add",
    path: "/metadata",
    value: VALID_SPEC.metadata,
  }),
  JSON.stringify({
    op: "add",
    path: "/routes",
    value: VALID_SPEC.routes,
  }),
].join("\n");

/** base=current：在根路由追加一个元素。 */
const EDIT_PATCH = [
  JSON.stringify({
    op: "add",
    path: "/routes/~1/page/elements/t2",
    value: {
      type: "Text",
      props: { text: "追加内容", variant: null },
      children: [],
    },
  }),
  JSON.stringify({
    op: "add",
    path: "/routes/~1/page/elements/root/children/-",
    value: "t2",
  }),
].join("\n");

async function committedCreate(
  controller: BundlePreviewController,
): Promise<void> {
  const result = await controller.stageGenerationPatch({
    generationId: "gen_create",
    base: "empty",
    patchText: CREATE_PATCH,
  });
  expect(result.status).toBe("committed");
}

/** 读取 minimal-bundle 夹具并替换为 runtime-valid spec（designSystem 原样保留）。 */
async function makeValidBundle(): Promise<AppUiBundle> {
  const raw = JSON.parse(
    await readFile(
      "tests/fixtures/design-system/minimal-bundle.v1.json",
      "utf8",
    ),
  ) as Record<string, unknown>;
  raw.spec = VALID_SPEC;
  return appUiBundleSchema.parse(raw);
}

describe("BundlePreviewController：v1 generation 补丁事务", () => {
  it("empty 基线补丁：单次 applySource → smoke → 原子提交（bundleRevision 单调 +1）", async () => {
    const { controller } = makeController();
    const before = controller.getSnapshot().active;
    const result = await controller.stageGenerationPatch({
      generationId: "gen_1",
      base: "empty",
      patchText: CREATE_PATCH,
    });
    expect(result.status).toBe("committed");
    const after = controller.getSnapshot().active;
    expect(after).not.toBe(before);
    expect(after?.bundleRevision).toBe((before?.bundleRevision ?? 0) + 1);
    expect(after?.execution).toEqual({
      phase: "unsaved",
      generationId: "gen_1",
    });
    expect(after?.spec?.routes?.["/"]).toBeDefined();
    expect(controller.getSnapshot().status).toBe("ready");
  });

  it("current 基线增量：候选携带当前 spec 出生，未触及路由的 pathname 保留", async () => {
    const { controller } = makeController();
    await committedCreate(controller);
    // 切到 /docs（模拟用户导航）
    controller.getActiveNavigation()?.push("/docs");

    const result = await controller.stageGenerationPatch({
      generationId: "gen_2",
      base: "current",
      patchText: EDIT_PATCH,
    });
    expect(result.status).toBe("committed");
    const active = controller.getSnapshot().active;
    expect(active?.spec?.routes?.["/"]?.page?.elements?.t2).toBeDefined();
    // 补丁未删除 /docs：pathname 保留
    expect(controller.getActiveNavigation()?.getSnapshot().pathname).toBe(
      "/docs",
    );
    expect(active?.execution).toEqual({
      phase: "unsaved",
      generationId: "gen_2",
    });
  });

  it("非法补丁：apply 失败 → rejected patch_invalid，active 与旧 revision 保持不变", async () => {
    const { controller } = makeController();
    await committedCreate(controller);
    const before = controller.getSnapshot().active;
    const runtimeBefore = before?.runtime;
    const result = await controller.stageGenerationPatch({
      generationId: "gen_bad",
      base: "empty",
      patchText: "{not json",
    });
    expect(result.status).toBe("rejected");
    // JSONL 行非合法 JSON 的稳定 code 是 patch_invalid（json_parse_failed
    // 属 kind:"json" 路径）。
    expect(result.status === "rejected" && result.error.code).toBe(
      "patch_invalid",
    );
    const after = controller.getSnapshot().active;
    expect(after).toBe(before);
    expect(after?.runtime).toBe(runtimeBefore);
    expect(controller.getSnapshot().status).toBe("failed");
    // 旧 revision 继续可用
    expect(after?.runtime.getSnapshot().current).not.toBeNull();
  });

  it("初始化超时：稳定 code preview_staging_timeout，旧 revision 保留", async () => {
    // dropInitialSource：候选出生无 initialSource → waitForSpecReady 永不
    // ready → 1ms 超时（确定性触发 timeout 分支）。
    const { controller } = makeController([], {
      stagingTimeoutMs: 1,
      dropInitialSource: true,
    });
    await committedCreate(controller);
    const before = controller.getSnapshot().active;
    const result = await controller.stageGenerationPatch({
      generationId: "gen_timeout",
      base: "current",
      patchText: EDIT_PATCH,
    });
    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" && result.error.code).toBe(
      "preview_staging_timeout",
    );
    expect(controller.getSnapshot().active).toBe(before);
    expect(controller.getSnapshot().status).toBe("failed");
  });

  it("swap 中断（预中止 signal）：cancelled，旧 revision 保留", async () => {
    const { controller } = makeController();
    await committedCreate(controller);
    const before = controller.getSnapshot().active;
    const abort = new AbortController();
    abort.abort();
    const result = await controller.stageGenerationPatch({
      generationId: "gen_abort",
      base: "empty",
      patchText: CREATE_PATCH,
      signal: abort.signal,
    });
    expect(result.status).toBe("cancelled");
    expect(controller.getSnapshot().active).toBe(before);
  });

  it("并发 staging：第二个事务 preview_staging_busy，第一个事务正常完成", async () => {
    const { controller } = makeController();
    await committedCreate(controller);
    // 第一个事务（base=current → initialSource 出生 → 等待 ready 的异步窗口）
    const first = controller.stageGenerationPatch({
      generationId: "gen_a",
      base: "current",
      patchText: EDIT_PATCH,
    });
    // 并发第二个：staging 已被占用 → 稳定拒绝
    const second = await controller.stageGenerationPatch({
      generationId: "gen_b",
      base: "empty",
      patchText: CREATE_PATCH,
    });
    expect(second.status).toBe("rejected");
    expect(second.status === "rejected" && second.error.code).toBe(
      "preview_staging_busy",
    );
    // 第一个事务不受影响
    const firstResult = await first;
    expect(firstResult.status).toBe("committed");
    expect(controller.getSnapshot().active?.bundleRevision).toBe(2);
  });

  it("smoke 失败（候选出生即 invalid）：稳定 code preview_smoke_failed，旧 revision 保留", async () => {
    // corruptInitialSource：候选出生的 initialSource 含未注册组件类型 →
    // specStatus 落入 invalid → waitForSpecReady 稳定拒绝。
    const { controller } = makeController([], {
      corruptInitialSource: true,
    });
    await committedCreate(controller);
    const before = controller.getSnapshot().active;
    const result = await controller.stageGenerationPatch({
      generationId: "gen_smoke",
      base: "current",
      patchText: EDIT_PATCH,
    });
    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" && result.error.code).toBe(
      "preview_smoke_failed",
    );
    expect(controller.getSnapshot().active).toBe(before);
    expect(controller.getSnapshot().status).toBe("failed");
  });

  it("重复 finish / 旧 finish：同 generationId 稳定拒绝 stale_generation", async () => {
    const { controller } = makeController();
    const first = await controller.stageGenerationPatch({
      generationId: "gen_dup",
      base: "empty",
      patchText: CREATE_PATCH,
    });
    expect(first.status).toBe("committed");
    const second = await controller.stageGenerationPatch({
      generationId: "gen_dup",
      base: "empty",
      patchText: CREATE_PATCH,
    });
    expect(second.status).toBe("rejected");
    expect(second.status === "rejected" && second.error.code).toBe(
      "stale_generation",
    );
    // active 不变（仍是第一次的提交）
    expect(controller.getSnapshot().active?.bundleRevision).toBe(1);
  });

  it("dispose 后回调：stage 稳定 cancelled，不写任何状态", async () => {
    const { controller } = makeController();
    await committedCreate(controller);
    const active = controller.getSnapshot().active;
    controller.dispose();
    const result = await controller.stageGenerationPatch({
      generationId: "gen_late",
      base: "empty",
      patchText: CREATE_PATCH,
    });
    expect(result.status).toBe("cancelled");
    // dispose 清空 active；旧 runtime 已销毁（幂等）
    expect(controller.getSnapshot().active).toBeNull();
    expect(active?.runtime.getSnapshot().current).not.toBeNull();
  });
});

describe("BundlePreviewController：v2 权威 Bundle 事务", () => {
  it("digest 匹配：committed，携带 uiBundleDigest 与 bundle", async () => {
    const bundle = await makeValidBundle();
    const digest = await digestCanonicalJson(bundle);
    const { controller } = makeController();
    const result = await controller.stageBundle({
      generationId: "gen_v2",
      bundle,
      expected: {
        candidateDigest: await digestCanonicalJson({ v2: bundle }),
        uiBundleDigest: digest,
        reportDigest: await digestCanonicalJson({ report: true }),
      },
    });
    expect(result).toMatchObject({
      status: "committed",
      uiBundleDigest: digest,
      bundleRevision: 1,
    });
    const active = controller.getSnapshot().active;
    expect(active?.uiBundleDigest).toBe(digest);
    expect(active?.bundle).not.toBeNull();
    expect(active?.spec?.routes?.["/"]).toBeDefined();
  });

  it("摘要错配：failed bundle_digest_mismatch，active 不变", async () => {
    const bundle = await makeValidBundle();
    const { controller } = makeController();
    await committedCreate(controller);
    const before = controller.getSnapshot().active;
    const result = await controller.stageBundle({
      generationId: "gen_v2_bad",
      bundle,
      expected: {
        candidateDigest: "sha256:" + "0".repeat(64),
        uiBundleDigest: "sha256:" + "0".repeat(64),
      },
    });
    expect(result).toMatchObject({
      status: "failed",
      code: "bundle_digest_mismatch",
    });
    expect(controller.getSnapshot().active).toBe(before);
  });

  it("schema 失败：failed bundle_invalid，不创建候选 Runtime", async () => {
    const { controller } = makeController();
    const result = await controller.stageBundle({
      generationId: "gen_v2_invalid",
      bundle: { bundleVersion: 999 },
      expected: {
        candidateDigest: "sha256:" + "0".repeat(64),
        uiBundleDigest: "sha256:" + "0".repeat(64),
      },
    });
    expect(result).toMatchObject({ status: "failed", code: "bundle_invalid" });
  });
});

describe("BundlePreviewController：draft/published 装载与 gate 推进", () => {
  it("stagePersisted(draft)：execution 绑定 draft，gate 出生即 draft", async () => {
    const { controller } = makeController();
    const result = await controller.stagePersisted({
      spec: VALID_SPEC,
      execution: { phase: "draft", draftId: "draft_1", generationId: "gen_x" },
    });
    expect(result.status).toBe("committed");
    const active = controller.getSnapshot().active;
    expect(active?.execution).toEqual({
      phase: "draft",
      draftId: "draft_1",
      generationId: "gen_x",
    });
    // draft gate：published 只能经新 Runtime 替换，就地跃迁被拒
    const dispatcher = active?.runtime.getActionDispatcher();
    expect(dispatcher?.transitionPhase("published")).toMatchObject({
      ok: false,
      code: "phase_jump",
    });
  });

  it("stagePersisted(published)：published 绑定，gate 拒绝一切后续推进", async () => {
    const { controller } = makeController();
    const result = await controller.stagePersisted({
      spec: VALID_SPEC,
      execution: { phase: "published", publishedVersionId: "pv_1" },
    });
    expect(result.status).toBe("committed");
    expect(controller.getSnapshot().active?.execution).toEqual({
      phase: "published",
      publishedVersionId: "pv_1",
    });
    const dispatcher = controller
      .getSnapshot()
      .active?.runtime.getActionDispatcher();
    expect(dispatcher?.transitionPhase("draft")).toMatchObject({
      ok: false,
      code: "phase_regression",
    });
  });

  it("confirmDraftCommitted：身份核对 + unsaved→draft 单调推进", async () => {
    const { controller } = makeController();
    const gen = await controller.stageGenerationPatch({
      generationId: "gen_confirm",
      base: "empty",
      patchText: CREATE_PATCH,
    });
    expect(gen.status).toBe("committed");
    const active = controller.getSnapshot().active;
    const identity = {
      appId: APP_ID,
      candidateDigest: active?.candidateDigest ?? "",
      bundleRevision: active?.bundleRevision ?? 0,
    };

    // 错 appId / 错 revision / 错 digest → identity_mismatch
    expect(
      controller.confirmDraftCommitted({
        ...identity,
        appId: "other",
        draftId: "d",
      }),
    ).toMatchObject({ ok: false, code: "identity_mismatch" });
    expect(
      controller.confirmDraftCommitted({
        ...identity,
        bundleRevision: identity.bundleRevision + 1,
        draftId: "d",
      }),
    ).toMatchObject({ ok: false, code: "identity_mismatch" });
    expect(
      controller.confirmDraftCommitted({
        ...identity,
        candidateDigest: "nope",
        draftId: "d",
      }),
    ).toMatchObject({ ok: false, code: "identity_mismatch" });

    // 正确身份 → draft
    const ok = controller.confirmDraftCommitted({
      ...identity,
      draftId: "draft_ok",
    });
    expect(ok).toEqual({ ok: true });
    expect(controller.getSnapshot().active?.execution).toEqual({
      phase: "draft",
      draftId: "draft_ok",
      generationId: "gen_confirm",
    });

    // 二次 confirm：phase_mismatch（不再处于 unsaved）
    expect(
      controller.confirmDraftCommitted({ ...identity, draftId: "draft_2" }),
    ).toMatchObject({ ok: false, code: "phase_mismatch" });
  });
});

describe("BundlePreviewController：store 事实面", () => {
  it("committed 后快照 ready、无 toast/dialog 残留", async () => {
    const { controller } = makeController();
    await committedCreate(controller);
    expect(controller.getSnapshot().status).toBe("ready");
    expect(controller.getSnapshot().toasts).toHaveLength(0);
    expect(controller.getSnapshot().openDialogElementIds).toHaveLength(0);
  });

  it("初始 active：空 Runtime（revision 0、无 current），specStatus empty", () => {
    const { controller } = makeController();
    const active = controller.getSnapshot().active;
    expect(active).not.toBeNull();
    const runtime = active?.runtime as NextAppRuntime | undefined;
    expect(runtime?.getSnapshot().revision).toBe(0);
    expect(runtime?.getSnapshot().current).toBeNull();
  });
});
