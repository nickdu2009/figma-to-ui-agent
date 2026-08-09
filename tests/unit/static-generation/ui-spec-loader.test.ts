import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectStore } from "../../../src/project-store/store.ts";
import { buildStaticUISpecFromDesignBundle } from "../../../src/static-generation/service.ts";
import { loadCurrentStaticUISpec } from "../../../src/static-generation/ui-spec-loader.ts";
import { createM5StaticDesignBundleDraft } from "../../fixtures/static-generation/m5-static-fixture.ts";

const temporaryRoots: string[] = [];

async function createStore(): Promise<{
  readonly root: string;
  readonly store: ProjectStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "figma-ui-static-spec-"));
  temporaryRoots.push(root);
  return { root, store: new ProjectStore(root) };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("loadCurrentStaticUISpec", () => {
  it("generates a UISpec when none exists", async () => {
    const { store } = await createStore();
    const bundle = await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createM5StaticDesignBundleDraft("demo-project"),
    });

    const result = await loadCurrentStaticUISpec({
      store,
      projectId: "demo-project",
      bundle,
      options: { m4ValidationStatus: "not_required" },
    });

    expect(result.reason).toBe("missing");
    expect(result.uiSpec.revision).toBe(1);
    expect(result.uiSpec.sourceDesignBundleRevision).toBe(bundle.revision);
    expect(result.uiSpec.pages).toHaveLength(bundle.pages.length);
  });

  it("reuses the current UISpec when it matches the DesignBundle revision", async () => {
    const { store } = await createStore();
    const bundle = await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createM5StaticDesignBundleDraft("demo-project"),
    });
    const { uiSpecDraft } = buildStaticUISpecFromDesignBundle(bundle, {
      m4ValidationStatus: "not_required",
    });
    const saved = await store.saveUISpec({
      projectId: "demo-project",
      baseRevision: 0,
      draft: uiSpecDraft,
    });

    const result = await loadCurrentStaticUISpec({
      store,
      projectId: "demo-project",
      bundle,
      options: { m4ValidationStatus: "not_required" },
    });

    expect(result.reason).toBe("current");
    expect(result.uiSpec.revision).toBe(saved.revision);
  });

  it("rebuilds a stale UISpec when the current DesignBundle revision changed", async () => {
    const { store } = await createStore();
    const firstBundle = await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createM5StaticDesignBundleDraft("demo-project"),
    });
    const { uiSpecDraft } = buildStaticUISpecFromDesignBundle(firstBundle, {
      m4ValidationStatus: "not_required",
    });
    await store.saveUISpec({
      projectId: "demo-project",
      baseRevision: 0,
      draft: uiSpecDraft,
    });

    const nextDraft = createM5StaticDesignBundleDraft("demo-project");
    nextDraft.warnings.push({
      code: "fixture_revision_change",
      detail: "测试 DesignBundle 修订变化后应重建 UISpec",
    });
    const nextBundle = await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: firstBundle.revision,
      draft: nextDraft,
    });

    const result = await loadCurrentStaticUISpec({
      store,
      projectId: "demo-project",
      bundle: nextBundle,
      options: { m4ValidationStatus: "not_required" },
    });

    expect(result.reason).toBe("stale_design_bundle_revision");
    expect(result.uiSpec.revision).toBe(2);
    expect(result.uiSpec.sourceDesignBundleRevision).toBe(nextBundle.revision);
    expect(result.uiSpec.pages).toHaveLength(nextBundle.pages.length);
  });
});
