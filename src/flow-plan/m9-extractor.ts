import type { DesignBundle } from "../design-bundle/schema.ts";
import type { FlowPlanDraft, FlowPlanInteraction } from "./schema.ts";
import {
  createFlowM9SampleCounts,
  flowM9SampleReportSchema,
  type FlowM9SampleClassification,
  type FlowM9SampleReport,
} from "./m9-report.ts";
import type { FlowM9SampleInput } from "./m9-samples.ts";

const SUBMIT_LIKE_RE =
  /\b(login|log in|sign in|signin|register|sign up|signup|submit|checkout|pay|payment|save|confirm|continue|next)\b|登录|注册|提交|支付|付款|结算|保存|确认|下一步|继续/i;

function prototypeInteractionCount(bundle: DesignBundle): number {
  return bundle.pages.reduce(
    (count, page) =>
      count +
      page.nodes.reduce(
        (nodeCount, node) =>
          nodeCount + (node.prototypeInteractions?.length ?? 0),
        0,
      ),
    0,
  );
}

function isSubmitLikeCandidate(
  sample: FlowM9SampleInput,
  interaction: FlowPlanInteraction,
): boolean {
  if (interaction.source !== "inferred" && interaction.source !== "missing") {
    return false;
  }
  const haystack = [
    sample.category,
    sample.title,
    interaction.sourceNodeName,
    interaction.blockedReason,
    interaction.reason,
  ]
    .filter(Boolean)
    .join(" ");
  return SUBMIT_LIKE_RE.test(haystack);
}

function classifyInteraction(
  sample: FlowM9SampleInput,
  interaction: FlowPlanInteraction,
): FlowM9SampleClassification {
  if (
    interaction.source === "figma" &&
    interaction.confirmed &&
    interaction.intent === "navigate"
  ) {
    return {
      classification: "trusted.navigate",
      interactionId: interaction.id,
      intent: interaction.intent,
      sourceNodeId: interaction.sourceNodeId,
      sourceNodeName: interaction.sourceNodeName,
      evidence: "Figma prototype NAVIGATE 已映射到 FlowPlan targetPageId。",
    };
  }
  if (
    interaction.source === "figma" &&
    interaction.confirmed &&
    interaction.intent === "set_state"
  ) {
    return {
      classification: "trusted.set_state",
      interactionId: interaction.id,
      intent: interaction.intent,
      sourceNodeId: interaction.sourceNodeId,
      sourceNodeName: interaction.sourceNodeName,
      evidence: "Figma prototype CHANGE_TO 已映射到 FlowPlan set_state。",
    };
  }
  if (isSubmitLikeCandidate(sample, interaction)) {
    return {
      classification: "needs_confirmation.submit_like",
      interactionId: interaction.id,
      intent: interaction.intent,
      sourceNodeId: interaction.sourceNodeId,
      sourceNodeName: interaction.sourceNodeName,
      blockedReason:
        interaction.blockedReason ?? "submit_like_requires_confirmation",
      evidence: "样本文案或类别暗示提交类行为，但缺少可验证 postcondition。",
    };
  }
  if (
    interaction.blockedReason === "prototype_target_missing" ||
    interaction.blockedReason === "prototype_target_page_missing" ||
    interaction.blockedReason === "interaction_target_missing"
  ) {
    return {
      classification: "missing_evidence",
      interactionId: interaction.id,
      intent: interaction.intent,
      sourceNodeId: interaction.sourceNodeId,
      sourceNodeName: interaction.sourceNodeName,
      blockedReason: interaction.blockedReason,
      evidence: "interaction 存在但缺少可验证目标或目标页面映射。",
    };
  }
  return {
    classification: "unsupported",
    interactionId: interaction.id,
    intent: interaction.intent,
    sourceNodeId: interaction.sourceNodeId,
    sourceNodeName: interaction.sourceNodeName,
    blockedReason: interaction.blockedReason ?? "unsupported_interaction",
    evidence: "当前 FlowPlan/UISpec 不能安全表达该 interaction。",
  };
}

export function buildFlowM9SampleReport(input: {
  readonly sample: FlowM9SampleInput;
  readonly bundle?: DesignBundle;
  readonly flowPlan?: FlowPlanDraft;
  readonly artifactRefs?: FlowM9SampleReport["artifactRefs"];
  readonly accessError?: string;
}): FlowM9SampleReport {
  if (input.accessError || !input.bundle || !input.flowPlan) {
    return flowM9SampleReportSchema.parse({
      sampleId: input.sample.sampleId,
      category: input.sample.category,
      expectedViewport: input.sample.expectedViewport,
      accessStatus: "not_accessible",
      interactionSource: "unavailable",
      counts: createFlowM9SampleCounts([], {
        prototypeInteractionCount: 0,
        flowPlanInteractionCount: 0,
      }),
      classifications: [
        {
          classification: "not_accessible",
          evidence: input.accessError ?? "sample_not_loaded",
        },
      ],
      blockedReasons: [input.accessError ?? "sample_not_loaded"],
      artifactRefs: input.artifactRefs ?? {},
    });
  }

  const prototypeCount = prototypeInteractionCount(input.bundle);
  const classifications =
    input.flowPlan.interactions.length > 0
      ? input.flowPlan.interactions.map((interaction) =>
          classifyInteraction(input.sample, interaction),
        )
      : [
          {
            classification: "missing_evidence" as const,
            evidence: "样本可读，但没有 FlowPlan interaction。",
          },
        ];
  if (prototypeCount === 0) {
    classifications.push({
      classification: "missing_evidence",
      evidence: "DesignBundle 中没有 prototypeInteractions。",
    });
  }

  const counts = createFlowM9SampleCounts(classifications, {
    prototypeInteractionCount: prototypeCount,
    flowPlanInteractionCount: input.flowPlan.interactions.length,
  });
  const blockedReasons = [
    ...new Set(
      classifications
        .map((item) => item.blockedReason)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  return flowM9SampleReportSchema.parse({
    sampleId: input.sample.sampleId,
    category: input.sample.category,
    expectedViewport: input.sample.expectedViewport,
    accessStatus: "readable",
    interactionSource:
      prototypeCount > 0
        ? "present"
        : input.flowPlan.figmaInteractionSource === "present"
          ? "present"
          : "absent",
    counts,
    classifications,
    blockedReasons,
    artifactRefs: input.artifactRefs ?? {},
  });
}
