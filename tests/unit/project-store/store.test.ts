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
