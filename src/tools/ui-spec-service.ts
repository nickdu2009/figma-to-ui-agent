import { SCHEMA_VERSION } from "../project-store/schemas.ts";
import { ProjectStore } from "../project-store/store.ts";
import {
  type LoadUISpecOutput,
  type SaveUISpecOutput,
  loadUISpecInputSchema,
  loadUISpecOutputSchema,
  saveUISpecInputSchema,
  saveUISpecOutputSchema,
} from "./contracts.ts";
import { collectScreenshotFallbackFeatures } from "./unsupported-features.ts";

export class UISpecToolService {
  private readonly projectStore: ProjectStore;

  constructor(projectStore: ProjectStore) {
    this.projectStore = projectStore;
  }

  async load(rawInput: unknown): Promise<LoadUISpecOutput> {
    const input = loadUISpecInputSchema.parse(rawInput);
    const uiSpec = await this.projectStore.loadUISpec(
      input.projectId,
      input.revision,
    );
    return loadUISpecOutputSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      projectId: uiSpec.projectId,
      revision: uiSpec.revision,
      uiSpec,
    });
  }

  async save(rawInput: unknown): Promise<SaveUISpecOutput> {
    const input = saveUISpecInputSchema.parse(rawInput);
    const saved = await this.projectStore.saveUISpec({
      projectId: input.projectId,
      baseRevision: input.baseRevision,
      draft: input.uiSpec,
    });
    const unsupportedFeatures = collectScreenshotFallbackFeatures(
      input.uiSpec,
      "schema_limit",
    );
    return saveUISpecOutputSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      projectId: saved.projectId,
      revision: saved.revision,
      validation: {
        schemaValid: true,
        referencesValid: true,
        warningCount: 0,
      },
      ...(unsupportedFeatures.length > 0 ? { unsupportedFeatures } : {}),
    });
  }
}
