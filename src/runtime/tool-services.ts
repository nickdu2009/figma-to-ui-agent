import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

import { FigmaImageDownloader } from "../figma/assets.ts";
import { FigmaInspector } from "../figma/inspector.ts";
import { FigmaRestClient } from "../figma/rest-client.ts";
import { ProjectStore } from "../project-store/store.ts";
import { ProjectStoreError } from "../project-store/store.ts";
import {
  assertManagedFilePath,
  ensureProjectLayout,
  resolveProjectPath,
} from "../project-store/path-safety.ts";
import type {
  InspectFigmaInput,
  InspectFigmaOutput,
  LoadUISpecInput,
  LoadUISpecOutput,
  RenderAndCompareInput,
  RenderAndCompareOutput,
  SaveUISpecInput,
  SaveUISpecOutput,
} from "../tools/contracts.ts";
import { UISpecToolService } from "../tools/ui-spec-service.ts";
import {
  applyFlowConfirmations,
  buildFlowPlan,
  flowPlanServiceSummary,
  generateFlowConfirmationQuestions,
} from "../flow-plan/service.ts";
import type {
  FlowPlan,
  FlowPlanDraft,
} from "../flow-plan/schema.ts";
import { RenderAndCompareService } from "../validation/render-and-compare.ts";
import {
  buildInspectAgentContext,
  type InspectAgentContext,
} from "./inspect-agent-context.ts";

const MAX_INSPECT_IMAGES = 4;
const MAX_INSPECT_IMAGE_BYTES = 40 * 1024 * 1024;

export interface InspectToolSupplement {
  context: InspectAgentContext;
  images: Array<{
    data: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
  }>;
}

export interface ExtensionToolServices {
  inspect(
    input: InspectFigmaInput,
    signal?: AbortSignal,
  ): Promise<InspectFigmaOutput>;
  inspectSupplement?(
    output: InspectFigmaOutput,
  ): Promise<InspectToolSupplement>;
  load(input: LoadUISpecInput): Promise<LoadUISpecOutput>;
  save(input: SaveUISpecInput): Promise<SaveUISpecOutput>;
  render(
    input: RenderAndCompareInput,
    signal?: AbortSignal,
  ): Promise<RenderAndCompareOutput>;
  close?(): Promise<void>;
}

export class LocalExtensionToolServices
  implements ExtensionToolServices
{
  private readonly store: ProjectStore;
  private readonly dataRoot: string;
  private readonly uiSpec: UISpecToolService;
  private readonly renderer: RenderAndCompareService;
  private inspector?: FigmaInspector;

  constructor(cwd: string) {
    const dataRoot = resolve(cwd, "data");
    this.dataRoot = dataRoot;
    this.store = new ProjectStore(dataRoot);
    this.uiSpec = new UISpecToolService(this.store);
    this.renderer = new RenderAndCompareService({
      dataRoot,
      projectStore: this.store,
    });
  }

  async inspect(
    input: InspectFigmaInput,
    signal?: AbortSignal,
  ): Promise<InspectFigmaOutput> {
    const output = await this.getInspector().inspect(input, signal);
    return await this.attachFlowPlan(input, output);
  }

  async load(input: LoadUISpecInput): Promise<LoadUISpecOutput> {
    return await this.uiSpec.load(input);
  }

  async inspectSupplement(
    output: InspectFigmaOutput,
  ): Promise<InspectToolSupplement> {
    const bundle = await this.store.loadDesignBundle(
      output.projectId,
      output.designBundleRevision,
    );
    const context = buildInspectAgentContext(bundle);
    const layout = await ensureProjectLayout(
      this.dataRoot,
      output.projectId,
    );
    const images: InspectToolSupplement["images"] = [];
    let totalBytes = 0;
    for (const page of context.pages) {
      if (
        images.length >= MAX_INSPECT_IMAGES ||
        !page.screenshotPath
      ) {
        continue;
      }
      const ref = bundle.screenshots.find(
        (candidate) => candidate.path === page.screenshotPath,
      );
      if (
        !ref ||
        totalBytes + ref.byteCount > MAX_INSPECT_IMAGE_BYTES
      ) {
        continue;
      }
      const path = resolveProjectPath(layout, ref.path);
      await assertManagedFilePath(layout, path);
      const bytes = await readFile(path);
      totalBytes += bytes.byteLength;
      images.push({
        data: bytes.toString("base64"),
        mimeType: ref.mimeType,
      });
    }
    return { context, images };
  }

  async save(input: SaveUISpecInput): Promise<SaveUISpecOutput> {
    return await this.uiSpec.save(input);
  }

  async render(
    input: RenderAndCompareInput,
    signal?: AbortSignal,
  ): Promise<RenderAndCompareOutput> {
    return await this.renderer.render(input, signal);
  }

  async close(): Promise<void> {
    await this.renderer.close();
  }

  private getInspector(): FigmaInspector {
    if (this.inspector) {
      return this.inspector;
    }
    const token = process.env.FIGMA_API_KEY?.trim();
    if (!token) {
      throw new Error(
        "inspect_figma 缺少 FIGMA_API_KEY 本地环境配置",
      );
    }
    const restClient = new FigmaRestClient({ token });
    this.inspector = new FigmaInspector({
      restClient,
      imageDownloader: new FigmaImageDownloader({
        projectStore: this.store,
      }),
      projectStore: this.store,
    });
    return this.inspector;
  }

  private async attachFlowPlan(
    input: InspectFigmaInput,
    output: InspectFigmaOutput,
  ): Promise<InspectFigmaOutput> {
    let uiSpec;
    try {
      uiSpec = await this.store.loadUISpec(output.projectId);
    } catch (error) {
      if (
        !(error instanceof ProjectStoreError) ||
        error.code !== "not_found"
      ) {
        throw error;
      }
    }

    let currentFlowPlan;
    try {
      currentFlowPlan = await this.store.loadFlowPlan(output.projectId);
    } catch (error) {
      if (
        !(error instanceof ProjectStoreError) ||
        error.code !== "not_found"
      ) {
        throw error;
      }
    }

    const bundle = await this.store.loadDesignBundle(
      output.projectId,
      output.designBundleRevision,
    );
    const flowConfirmations = input.flowConfirmations ?? [];
    const canReuseCurrent = Boolean(
      currentFlowPlan &&
      currentFlowPlan.sourceDesignBundleRevision ===
        output.designBundleRevision &&
        currentFlowPlan.sourceUISpecRevision === uiSpec?.revision,
    );

    let flowPlan: FlowPlan | FlowPlanDraft;
    if (canReuseCurrent && currentFlowPlan) {
      flowPlan = currentFlowPlan;
    } else {
      flowPlan = generateFlowConfirmationQuestions(
        buildFlowPlan({
          bundle,
          uiSpec,
          figmaInteractionSource: "absent",
        }),
      );
    }

    if (flowConfirmations.length > 0) {
      flowPlan = applyFlowConfirmations(flowPlan, flowConfirmations);
    }

    let storedFlowPlan: FlowPlan;
    if (!canReuseCurrent || flowConfirmations.length > 0) {
      storedFlowPlan = await this.store.saveFlowPlan({
        projectId: output.projectId,
        baseRevision: currentFlowPlan?.revision ?? 0,
        draft: flowPlan,
      });
    } else if (currentFlowPlan) {
      storedFlowPlan = currentFlowPlan;
    } else {
      throw new Error("flow_plan_reuse_state_invalid");
    }

    const summary = flowPlanServiceSummary(storedFlowPlan);
    return {
      ...output,
      flowPlanRevision: storedFlowPlan.revision,
      ...summary,
    };
  }
}
