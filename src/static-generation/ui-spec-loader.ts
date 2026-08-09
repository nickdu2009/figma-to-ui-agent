import type { DesignBundle } from "../design-bundle/schema.ts";
import { ProjectStore, ProjectStoreError } from "../project-store/store.ts";
import type { UISpec } from "../ui-spec/schema.ts";
import {
  buildStaticUISpecFromDesignBundle,
  type BuildStaticUISpecOptions,
} from "./service.ts";

export type StaticUISpecLoadReason =
  | "current"
  | "missing"
  | "stale_design_bundle_revision";

export interface LoadCurrentStaticUISpecInput {
  readonly store: ProjectStore;
  readonly projectId: string;
  readonly bundle: DesignBundle;
  readonly options?: BuildStaticUISpecOptions;
}

export interface LoadCurrentStaticUISpecResult {
  readonly uiSpec: UISpec;
  readonly reason: StaticUISpecLoadReason;
}

export async function loadCurrentStaticUISpec(
  input: LoadCurrentStaticUISpecInput,
): Promise<LoadCurrentStaticUISpecResult> {
  let currentUiSpec: UISpec | undefined;
  let reason: StaticUISpecLoadReason = "missing";

  try {
    currentUiSpec = await input.store.loadUISpec(input.projectId);
    if (
      currentUiSpec.projectId === input.bundle.projectId &&
      currentUiSpec.sourceDesignBundleRevision === input.bundle.revision
    ) {
      return { uiSpec: currentUiSpec, reason: "current" };
    }
    reason = "stale_design_bundle_revision";
  } catch (error) {
    if (!(error instanceof ProjectStoreError) || error.code !== "not_found") {
      throw error;
    }
  }

  const { uiSpecDraft } = buildStaticUISpecFromDesignBundle(
    input.bundle,
    input.options,
  );
  const uiSpec = await input.store.saveUISpec({
    projectId: input.projectId,
    baseRevision: currentUiSpec?.revision ?? 0,
    draft: uiSpecDraft,
  });
  return { uiSpec, reason };
}
