import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { designBundleSchema } from "../../../src/design-bundle/schema.ts";
import {
  FLOW_PLAN_SCHEMA_VERSION,
  type FlowPlanDraft,
} from "../../../src/flow-plan/schema.ts";
import {
  ProjectStore,
  ProjectStoreError,
} from "../../../src/project-store/store.ts";
import {
  FIXTURE_SCREENSHOT_PATH,
  createDesignBundleDraft,
  createDesignBundleDraftWithScreenshot,
  createRootScreenshotUISpecDraft,
  createUISpecDraft,
} from "../../fixtures/contracts.ts";

const temporaryRoots: string[] = [];

async function createStore(): Promise<{
  root: string;
  store: ProjectStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "figma-ui-store-"));
  temporaryRoots.push(root);
  return { root, store: new ProjectStore(root) };
}

function expectStoreCode(code: ProjectStoreError["code"]) {
  return expect.objectContaining({
    name: "ProjectStoreError",
    code,
  });
}

function createFlowPlanDraft(
  projectId = "demo-project",
  sourceDesignBundleRevision = 1,
  sourceUISpecRevision?: number,
): FlowPlanDraft {
  return {
    schemaVersion: FLOW_PLAN_SCHEMA_VERSION,
    projectId,
    sourceDesignBundleRevision,
    sourceUISpecRevision,
    figmaInteractionSource: "absent",
    pages: [
      {
        id: "home",
        sourcePageId: "page-home",
        name: "首页",
        role: "entry",
        confidence: "medium",
        reason: "store fixture",
      },
    ],
    interactions: [
      {
        id: "continue-missing",
        source: "missing",
        uiNodeId: "continue",
        trigger: "click",
        intent: "unknown",
        fromPageId: "home",
        confirmed: false,
        confidence: "low",
        reason: "无 prototype 证据",
        blockedReason: "prototype_absent",
      },
    ],
    stateMachines: [],
    confirmationQuestions: [
      {
        id: "confirm-continue",
        interactionId: "continue-missing",
        question: "继续按钮是否有交互？",
        options: [
          { label: "保持静态", value: "static" },
          { label: "跳转首页", value: "target:home" },
        ],
        required: true,
      },
    ],
    confirmations: [],
    report: {
      unsupportedCount: 1,
      unresolvedInteractionCount: 1,
      convertedActionCount: 0,
      behaviorFixtureCount: 0,
      confirmationCount: 0,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("ProjectStore", () => {
  it("保存 current 和不可变历史，并按 CAS 增长修订", async () => {
    const { root, store } = await createStore();
    const first = await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createDesignBundleDraft(),
    });
    const secondDraft = createDesignBundleDraft();
    secondDraft.warnings.push({
      code: "inferred_spacing",
      detail: "间距来自节点属性推断",
    });
    const second = await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 1,
      draft: secondDraft,
    });

    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    await expect(store.loadDesignBundle("demo-project")).resolves.toEqual(
      second,
    );
    await expect(
      store.loadDesignBundle("demo-project", 1),
    ).resolves.toEqual(first);
    expect(
      (
        await stat(
          join(
            root,
            "projects",
            "demo-project",
            "figma",
            "assets",
          ),
        )
      ).isDirectory(),
    ).toBe(true);
    expect(
      (
        await stat(
          join(
            root,
            "projects",
            "demo-project",
            "figma",
            "screenshots",
          ),
        )
      ).isDirectory(),
    ).toBe(true);
    expect(
      (
        await stat(
          join(root, "projects", "demo-project", "figma", "fonts"),
        )
      ).isDirectory(),
    ).toBe(true);
  });

  it("陈旧 CAS 和无效草稿都不会覆盖 current", async () => {
    const { store } = await createStore();
    const first = await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createDesignBundleDraft(),
    });
    const changed = createDesignBundleDraft();
    changed.warnings.push({
      code: "changed",
      detail: "并发候选",
    });

    await expect(
      store.saveDesignBundle({
        projectId: "demo-project",
        baseRevision: 0,
        draft: changed,
      }),
    ).rejects.toEqual(expectStoreCode("revision_conflict"));
    await expect(
      store.saveDesignBundle({
        projectId: "demo-project",
        baseRevision: 1,
        draft: {
          ...changed,
          unexpected: true,
        },
      }),
    ).rejects.toThrow();
    await expect(store.loadDesignBundle("demo-project")).resolves.toEqual(
      first,
    );
  });

  it("并发写同一 baseRevision 时只允许一个候选成功", async () => {
    const { store } = await createStore();
    const firstDraft = createDesignBundleDraft();
    firstDraft.warnings.push({
      code: "candidate_a",
      detail: "候选 A",
    });
    const secondDraft = createDesignBundleDraft();
    secondDraft.warnings.push({
      code: "candidate_b",
      detail: "候选 B",
    });

    const results = await Promise.allSettled([
      store.saveDesignBundle({
        projectId: "demo-project",
        baseRevision: 0,
        draft: firstDraft,
      }),
      store.saveDesignBundle({
        projectId: "demo-project",
        baseRevision: 0,
        draft: secondDraft,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejection = results.find(
      (result) => result.status === "rejected",
    );
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: expectStoreCode("revision_conflict"),
    });
  });

  it("按内容哈希保存本地字体并拒绝同 face 不同内容", async () => {
    const { root, store } = await createStore();
    const font = await store.saveLocalFont({
      projectId: "demo-project",
      bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x32]),
      family: "League Spartan",
      weight: 300,
      style: "normal",
      sourceKind: "user_provided",
    });

    expect(font.path).toMatch(/^figma\/fonts\/[a-f0-9]{64}\.woff2$/);
    await expect(
      readFile(join(root, "projects", "demo-project", font.path)),
    ).resolves.toEqual(Buffer.from([0x77, 0x4f, 0x46, 0x32]));

    const draft = createDesignBundleDraft();
    draft.fonts.push(font);
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft,
    });

    await expect(
      store.saveLocalFont({
        projectId: "demo-project",
        bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x46]),
        family: "League Spartan",
        weight: 300,
        style: "normal",
        sourceKind: "user_provided",
      }),
    ).rejects.toEqual(expectStoreCode("invalid_input"));
  });

  it("复用崩溃后已发布的相同历史，并拒绝不同历史", async () => {
    const { root, store } = await createStore();
    await store.initializeProject("demo-project");
    const draft = createDesignBundleDraft();
    const candidate = designBundleSchema.parse({
      ...draft,
      revision: 1,
    });
    const historyPath = join(
      root,
      "projects",
      "demo-project",
      "figma",
      "history",
      "1.json",
    );
    await writeFile(
      historyPath,
      `${JSON.stringify(candidate, null, 2)}\n`,
      "utf8",
    );

    await expect(
      store.saveDesignBundle({
        projectId: "demo-project",
        baseRevision: 0,
        draft,
      }),
    ).resolves.toEqual(candidate);

    const { root: conflictRoot, store: conflictStore } =
      await createStore();
    await conflictStore.initializeProject("demo-project");
    const different = {
      ...candidate,
      warnings: [
        {
          code: "different",
          detail: "不同的孤立历史",
        },
      ],
    };
    const conflictHistory = join(
      conflictRoot,
      "projects",
      "demo-project",
      "figma",
      "history",
      "1.json",
    );
    await writeFile(
      conflictHistory,
      `${JSON.stringify(different, null, 2)}\n`,
      "utf8",
    );

    await expect(
      conflictStore.saveDesignBundle({
        projectId: "demo-project",
        baseRevision: 0,
        draft,
      }),
    ).rejects.toEqual(
      expectStoreCode("immutable_history_conflict"),
    );
    await expect(
      conflictStore.loadDesignBundle("demo-project"),
    ).rejects.toEqual(expectStoreCode("not_found"));
  });

  it("清理已知孤立临时文件后发布 current", async () => {
    const { root, store } = await createStore();
    await store.initializeProject("demo-project");
    const figmaRoot = join(
      root,
      "projects",
      "demo-project",
      "figma",
    );
    const temporary = join(
      figmaRoot,
      ".current.json.00000000-0000-0000-0000-000000000000.tmp",
    );
    await writeFile(temporary, "partial", "utf8");

    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createDesignBundleDraft(),
    });

    await expect(readFile(temporary, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("回收已退出进程遗留的项目写锁", async () => {
    const { root, store } = await createStore();
    await store.initializeProject("demo-project");
    const lockPath = join(
      root,
      "projects",
      "demo-project",
      ".store-lock",
    );
    await mkdir(lockPath);
    await writeFile(
      join(lockPath, "owner.json"),
      `${JSON.stringify({
        pid: 2_147_483_647,
        token: "abandoned",
        createdAt: "2026-07-23T10:00:00.000Z",
      })}\n`,
      "utf8",
    );

    await expect(
      store.saveDesignBundle({
        projectId: "demo-project",
        baseRevision: 0,
        draft: createDesignBundleDraft(),
      }),
    ).resolves.toMatchObject({ revision: 1 });
  });

  it("把损坏的 current 分类为无效存储而不是不存在", async () => {
    const { root, store } = await createStore();
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createDesignBundleDraft(),
    });
    await writeFile(
      join(
        root,
        "projects",
        "demo-project",
        "figma",
        "current.json",
      ),
      "{}\n",
      "utf8",
    );

    await expect(
      store.loadDesignBundle("demo-project"),
    ).rejects.toEqual(expectStoreCode("invalid_stored_data"));
  });

  it("UISpec 必须引用当前 DesignBundle 且跨文档引用存在", async () => {
    const { store } = await createStore();
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createDesignBundleDraft(),
    });
    const firstSpec = await store.saveUISpec({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createUISpecDraft(),
    });
    expect(firstSpec.revision).toBe(1);

    const secondBundle = createDesignBundleDraft();
    secondBundle.warnings.push({
      code: "new_bundle",
      detail: "新的 DesignBundle",
    });
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 1,
      draft: secondBundle,
    });

    await expect(
      store.saveUISpec({
        projectId: "demo-project",
        baseRevision: 1,
        draft: createUISpecDraft("demo-project", 1),
      }),
    ).rejects.toEqual(
      expectStoreCode("cross_reference_invalid"),
    );
    await expect(store.loadUISpec("demo-project")).resolves.toEqual(
      firstSpec,
    );

    const missingReference = createUISpecDraft("demo-project", 2);
    missingReference.designValueRefs = [
      "color.background",
      "missing-value",
    ];
    await expect(
      store.saveUISpec({
        projectId: "demo-project",
        baseRevision: 1,
        draft: missingReference,
      }),
    ).rejects.toEqual(
      expectStoreCode("cross_reference_invalid"),
    );
  });

  it("FlowPlan 使用 current/history/CAS 持久化并校验引用", async () => {
    const { root, store } = await createStore();
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createDesignBundleDraft(),
    });
    await store.saveUISpec({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createUISpecDraft(),
    });

    const first = await store.saveFlowPlan({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createFlowPlanDraft("demo-project", 1, 1),
    });
    const changed = createFlowPlanDraft("demo-project", 1, 1);
    changed.confirmations.push({
      questionId: "confirm-continue",
      value: "static",
      appliedAt: "2026-07-24T10:00:00.000Z",
      result: "declined",
    });
    changed.report.confirmationCount = 1;
    const second = await store.saveFlowPlan({
      projectId: "demo-project",
      baseRevision: 1,
      draft: changed,
    });

    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    await expect(store.loadFlowPlan("demo-project")).resolves.toEqual(
      second,
    );
    await expect(store.loadFlowPlan("demo-project", 1)).resolves.toEqual(
      first,
    );
    expect(
      (
        await stat(
          join(root, "projects", "demo-project", "flow", "history"),
        )
      ).isDirectory(),
    ).toBe(true);

    await expect(
      store.saveFlowPlan({
        projectId: "demo-project",
        baseRevision: 1,
        draft: changed,
      }),
    ).rejects.toEqual(expectStoreCode("revision_conflict"));
    await expect(store.loadFlowPlan("demo-project")).resolves.toEqual(
      second,
    );
  });

  it("FlowPlan 拒绝缺失或陈旧的 DesignBundle/UISpec 引用", async () => {
    const { store } = await createStore();

    await expect(
      store.saveFlowPlan({
        projectId: "demo-project",
        baseRevision: 0,
        draft: createFlowPlanDraft(),
      }),
    ).rejects.toEqual(expectStoreCode("cross_reference_invalid"));

    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createDesignBundleDraft(),
    });
    await expect(
      store.saveFlowPlan({
        projectId: "demo-project",
        baseRevision: 0,
        draft: createFlowPlanDraft("demo-project", 2),
      }),
    ).rejects.toEqual(expectStoreCode("cross_reference_invalid"));
    await expect(
      store.saveFlowPlan({
        projectId: "demo-project",
        baseRevision: 0,
        draft: createFlowPlanDraft("demo-project", 1, 99),
      }),
    ).rejects.toEqual(expectStoreCode("cross_reference_invalid"));
    await expect(store.loadFlowPlan("demo-project")).rejects.toEqual(
      expectStoreCode("not_found"),
    );
  });

  it("UISpec 可追溯引用已保存 FlowPlan，缺失引用会失败", async () => {
    const { store } = await createStore();
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createDesignBundleDraft(),
    });

    const missingFlowRef = createUISpecDraft();
    missingFlowRef.sourceFlowPlanRevision = 1;
    await expect(
      store.saveUISpec({
        projectId: "demo-project",
        baseRevision: 0,
        draft: missingFlowRef,
      }),
    ).rejects.toEqual(expectStoreCode("cross_reference_invalid"));

    await store.saveFlowPlan({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createFlowPlanDraft(),
    });
    const validFlowRef = createUISpecDraft();
    validFlowRef.sourceFlowPlanRevision = 1;
    await expect(
      store.saveUISpec({
        projectId: "demo-project",
        baseRevision: 0,
        draft: validFlowRef,
      }),
    ).resolves.toMatchObject({
      revision: 1,
      sourceFlowPlanRevision: 1,
    });
  });

  it("UISpec 的 pixel_overlay 必须引用已登记图片", async () => {
    const { store } = await createStore();
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createDesignBundleDraft(),
    });
    const draft = createUISpecDraft();
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("overlay");
    }
    draft.nodes.push({
      id: "overlay",
      kind: "pixel_overlay",
      assetRef: FIXTURE_SCREENSHOT_PATH,
      alt: "未登记覆盖层",
      width: 120,
      height: 80,
      childIds: [],
      designValueRefs: [],
    });

    await expect(
      store.saveUISpec({
        projectId: "demo-project",
        baseRevision: 0,
        draft,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ProjectStoreError",
        code: "cross_reference_invalid",
        message: expect.stringContaining(FIXTURE_SCREENSHOT_PATH),
      }),
    );
  });

  it("拒绝 root 单截图作为 UISpec 交付", async () => {
    const { store } = await createStore();
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createDesignBundleDraftWithScreenshot(),
    });

    await expect(
      store.saveUISpec({
        projectId: "demo-project",
        baseRevision: 0,
        draft: createRootScreenshotUISpecDraft(),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ProjectStoreError",
        code: "cross_reference_invalid",
        message: expect.stringContaining(
          "full_page_screenshot_fallback_rejected",
        ),
      }),
    );
    await expect(
      store.loadUISpec("demo-project"),
    ).rejects.toEqual(expectStoreCode("not_found"));
  });

  it("拒绝 pixel_overlay 作为 root 单截图交付", async () => {
    const { store } = await createStore();
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createDesignBundleDraftWithScreenshot(),
    });
    const draft = createRootScreenshotUISpecDraft();
    draft.nodes = draft.nodes.map((node) =>
      node.id === "screenshot"
        ? {
            id: "screenshot",
            kind: "pixel_overlay",
            assetRef: FIXTURE_SCREENSHOT_PATH,
            alt: "整页截图覆盖层",
            width: 1440,
            height: 900,
            childIds: [],
            designValueRefs: [],
          }
        : node,
    );

    await expect(
      store.saveUISpec({
        projectId: "demo-project",
        baseRevision: 0,
        draft,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ProjectStoreError",
        code: "cross_reference_invalid",
        message: expect.stringContaining(
          "full_page_screenshot_fallback_rejected",
        ),
      }),
    );
  });

  it("拒绝项目目录符号链接逃逸", async () => {
    const { root, store } = await createStore();
    const outside = await mkdtemp(join(tmpdir(), "figma-ui-outside-"));
    temporaryRoots.push(outside);
    await mkdir(join(root, "projects"), { recursive: true });
    await symlink(
      outside,
      join(root, "projects", "demo-project"),
      "dir",
    );

    await expect(
      store.initializeProject("demo-project"),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ProjectPathError",
        code: "symlink_forbidden",
      }),
    );
  });
});
