import { readFile } from "node:fs/promises";

import type { UISpec, UISpecDraft } from "../ui-spec/schema.ts";
import {
  flowPlanDraftSchema,
  flowPlanSchema,
  type FlowPlan,
  type FlowPlanDraft,
  type FlowPlanInteraction,
  type FlowPostcondition,
} from "./schema.ts";

export type FlowM11ArtifactCarrier =
  | "flow_plan"
  | "summary_only"
  | "scenario_only";

export type FlowM11ArtifactLoadReasonCode =
  | "flow_plan_artifact_missing"
  | "flow_plan_artifact_unreadable"
  | "flow_plan_schema_invalid"
  | "flow_plan_reference_dangling"
  | "flow_plan_summary_only_carrier"
  | "flow_plan_scenario_only_carrier"
  | "flow_plan_untrusted_source";

export interface FlowM11ArtifactRejection {
  readonly reasonCode: FlowM11ArtifactLoadReasonCode;
  readonly message: string;
  readonly interactionId?: string;
  readonly field?: string;
  readonly ref?: string;
}

export type FlowM11ArtifactLoadResult =
  | {
      readonly status: "loaded";
      readonly artifactRef: string;
      readonly flowPlan: FlowPlan | FlowPlanDraft;
      readonly reasonCodes: [];
      readonly rejections: [];
    }
  | {
      readonly status: "partial";
      readonly artifactRef: string;
      readonly flowPlan: FlowPlan | FlowPlanDraft;
      readonly reasonCodes: FlowM11ArtifactLoadReasonCode[];
      readonly rejections: FlowM11ArtifactRejection[];
    }
  | {
      readonly status: "rejected";
      readonly artifactRef: string;
      readonly reasonCodes: FlowM11ArtifactLoadReasonCode[];
      readonly rejections: FlowM11ArtifactRejection[];
    };

export interface LoadFlowM11ArtifactInput {
  readonly artifactRef: string;
  readonly carrier?: FlowM11ArtifactCarrier;
  readonly rawFlowPlan?: unknown;
  readonly uiSpec?: UISpec | UISpecDraft;
  readonly readText?: (path: string) => Promise<string>;
}

function uniqueReasonCodes(
  rejections: readonly FlowM11ArtifactRejection[],
): FlowM11ArtifactLoadReasonCode[] {
  return [...new Set(rejections.map((rejection) => rejection.reasonCode))];
}

function rejected(
  artifactRef: string,
  rejections: readonly FlowM11ArtifactRejection[],
): FlowM11ArtifactLoadResult {
  return {
    status: "rejected",
    artifactRef,
    reasonCodes: uniqueReasonCodes(rejections),
    rejections: [...rejections],
  };
}

function parseFlowPlanArtifact(raw: unknown): FlowPlan | FlowPlanDraft | undefined {
  const parsedFlowPlan = flowPlanSchema.safeParse(raw);
  if (parsedFlowPlan.success) {
    return parsedFlowPlan.data;
  }
  const parsedDraft = flowPlanDraftSchema.safeParse(raw);
  if (parsedDraft.success) {
    return parsedDraft.data;
  }
  return undefined;
}

function nodeRefExists(
  nodeId: string,
  nodeIds: ReadonlySet<string> | undefined,
): boolean {
  return nodeIds === undefined || nodeIds.has(nodeId);
}

function stateKeyExists(
  stateKey: string,
  stateKeys: ReadonlySet<string> | undefined,
): boolean {
  return stateKeys === undefined || stateKeys.has(stateKey);
}

function postconditionReferenceIssues(
  postcondition: FlowPostcondition,
  pageIds: ReadonlySet<string>,
  nodeIds: ReadonlySet<string> | undefined,
  owner: string,
): FlowM11ArtifactRejection[] {
  if (postcondition.kind === "expect_page") {
    if (!pageIds.has(postcondition.pageId)) {
      return [
        {
          reasonCode: "flow_plan_reference_dangling",
          message: `${owner} references missing page ${postcondition.pageId}`,
          field: "postconditions.pageId",
          ref: postcondition.pageId,
        },
      ];
    }
    return [];
  }
  if (!nodeRefExists(postcondition.nodeId, nodeIds)) {
    return [
      {
        reasonCode: "flow_plan_reference_dangling",
        message: `${owner} references missing node ${postcondition.nodeId}`,
        field: "postconditions.nodeId",
        ref: postcondition.nodeId,
      },
    ];
  }
  return [];
}

function validateRuntimeReferences(
  flowPlan: FlowPlan | FlowPlanDraft,
  uiSpec: UISpec | UISpecDraft | undefined,
): FlowM11ArtifactRejection[] {
  const pageIds = new Set(flowPlan.pages.map((page) => page.id));
  const nodeIds = uiSpec
    ? new Set(uiSpec.nodes.map((node) => node.id))
    : undefined;
  const stateKeys = uiSpec
    ? new Set(uiSpec.state.map((state) => state.key))
    : undefined;
  const issues: FlowM11ArtifactRejection[] = [];

  for (const interaction of flowPlan.interactions) {
    if (interaction.uiNodeId && !nodeRefExists(interaction.uiNodeId, nodeIds)) {
      issues.push({
        reasonCode: "flow_plan_reference_dangling",
        message: `interaction ${interaction.id} references missing ui node ${interaction.uiNodeId}`,
        interactionId: interaction.id,
        field: "uiNodeId",
        ref: interaction.uiNodeId,
      });
    }
    if (
      interaction.dialogNodeId &&
      !nodeRefExists(interaction.dialogNodeId, nodeIds)
    ) {
      issues.push({
        reasonCode: "flow_plan_reference_dangling",
        message: `interaction ${interaction.id} references missing dialog node ${interaction.dialogNodeId}`,
        interactionId: interaction.id,
        field: "dialogNodeId",
        ref: interaction.dialogNodeId,
      });
    }
    if (
      interaction.stateKey &&
      !stateKeyExists(interaction.stateKey, stateKeys)
    ) {
      issues.push({
        reasonCode: "flow_plan_reference_dangling",
        message: `interaction ${interaction.id} references missing state key ${interaction.stateKey}`,
        interactionId: interaction.id,
        field: "stateKey",
        ref: interaction.stateKey,
      });
    }
    for (const postcondition of interaction.postconditions ?? []) {
      issues.push(
        ...postconditionReferenceIssues(
          postcondition,
          pageIds,
          nodeIds,
          `interaction ${interaction.id}`,
        ).map((issue) => ({ ...issue, interactionId: interaction.id })),
      );
    }
  }

  for (const machine of flowPlan.stateMachines) {
    for (const transition of machine.transitions) {
      for (const postcondition of transition.postconditions) {
        issues.push(
          ...postconditionReferenceIssues(
            postcondition,
            pageIds,
            nodeIds,
            `state transition ${transition.id}`,
          ),
        );
      }
    }
  }

  return issues;
}

function isTrustedExecutableInteraction(
  interaction: FlowPlanInteraction,
): boolean {
  return (
    (interaction.source === "figma" || interaction.source === "user_confirmed") &&
    interaction.confirmed &&
    interaction.intent !== "unknown"
  );
}

function untrustedSourceRejections(
  flowPlan: FlowPlan | FlowPlanDraft,
): FlowM11ArtifactRejection[] {
  return flowPlan.interactions
    .filter((interaction) => !isTrustedExecutableInteraction(interaction))
    .map((interaction) => ({
      reasonCode: "flow_plan_untrusted_source" as const,
      message: `interaction ${interaction.id} is not trusted executable flow evidence`,
      interactionId: interaction.id,
      field: "source",
      ref: interaction.source,
    }));
}

async function readRawFlowPlan(
  input: LoadFlowM11ArtifactInput,
): Promise<
  | { readonly ok: true; readonly raw: unknown }
  | { readonly ok: false; readonly rejections: FlowM11ArtifactRejection[] }
> {
  if (input.rawFlowPlan !== undefined) {
    return { ok: true, raw: input.rawFlowPlan };
  }

  const readText = input.readText ?? ((path: string) => readFile(path, "utf8"));
  try {
    const text = await readText(input.artifactRef);
    return { ok: true, raw: JSON.parse(text) };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return {
        ok: false,
        rejections: [
          {
            reasonCode: "flow_plan_artifact_missing",
            message: `flow plan artifact not found: ${input.artifactRef}`,
          },
        ],
      };
    }
    return {
      ok: false,
      rejections: [
        {
          reasonCode: "flow_plan_artifact_unreadable",
          message: `flow plan artifact unreadable: ${input.artifactRef}`,
        },
      ],
    };
  }
}

export async function loadFlowM11Artifact(
  input: LoadFlowM11ArtifactInput,
): Promise<FlowM11ArtifactLoadResult> {
  const carrier = input.carrier ?? "flow_plan";
  if (
    input.artifactRef === "ephemeral-flow-plan" ||
    carrier === "summary_only"
  ) {
    return rejected(input.artifactRef, [
      {
        reasonCode: "flow_plan_summary_only_carrier",
        message: "summary-only or ephemeral FlowPlan cannot be executed",
      },
    ]);
  }
  if (carrier === "scenario_only") {
    return rejected(input.artifactRef, [
      {
        reasonCode: "flow_plan_scenario_only_carrier",
        message: "scenario-only evidence cannot be executed as FlowPlan",
      },
    ]);
  }

  const raw = await readRawFlowPlan(input);
  if (!raw.ok) {
    return rejected(input.artifactRef, raw.rejections);
  }

  const flowPlan = parseFlowPlanArtifact(raw.raw);
  if (!flowPlan) {
    return rejected(input.artifactRef, [
      {
        reasonCode: "flow_plan_schema_invalid",
        message: "flow plan artifact failed FlowPlan schema validation",
      },
    ]);
  }

  const referenceIssues = validateRuntimeReferences(flowPlan, input.uiSpec);
  if (referenceIssues.length > 0) {
    return rejected(input.artifactRef, referenceIssues);
  }

  const sourceRejections = untrustedSourceRejections(flowPlan);
  if (sourceRejections.length === 0) {
    return {
      status: "loaded",
      artifactRef: input.artifactRef,
      flowPlan,
      reasonCodes: [],
      rejections: [],
    };
  }

  if (flowPlan.interactions.some(isTrustedExecutableInteraction)) {
    return {
      status: "partial",
      artifactRef: input.artifactRef,
      flowPlan,
      reasonCodes: uniqueReasonCodes(sourceRejections),
      rejections: sourceRejections,
    };
  }

  return rejected(input.artifactRef, sourceRejections);
}
