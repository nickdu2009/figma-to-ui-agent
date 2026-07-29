import type { UISpec, UISpecDraft } from "../ui-spec/schema.ts";
import type {
  FlowPlan,
  FlowPlanDraft,
  FlowPlanInteraction,
} from "./schema.ts";
import {
  applyFlowPlanToUISpec,
  type ApplyFlowPlanOptions,
} from "./to-ui-spec.ts";

export interface FlowM6RouteExecutionResult {
  readonly uiSpec: UISpecDraft;
  readonly convertedNavigateActionIds: string[];
  readonly behaviorFixtureIds: string[];
  readonly unresolvedInteractions: FlowPlanInteraction[];
}

function markOutOfScope(
  interaction: FlowPlanInteraction,
): FlowPlanInteraction {
  if (interaction.intent === "navigate") {
    return interaction;
  }
  return {
    ...interaction,
    confirmed: false,
    blockedReason:
      interaction.blockedReason ?? "flow_m6_non_navigate_out_of_scope",
  };
}

export function applyFlowM6RouteExecutionToUISpec(
  uiSpec: UISpec | UISpecDraft,
  flowPlan: FlowPlan | FlowPlanDraft,
  options: ApplyFlowPlanOptions = {},
): FlowM6RouteExecutionResult {
  const routeOnlyFlowPlan = {
    ...flowPlan,
    interactions: flowPlan.interactions.map(markOutOfScope),
  };
  const result = applyFlowPlanToUISpec(uiSpec, routeOnlyFlowPlan, options);
  return {
    uiSpec: result.uiSpec,
    convertedNavigateActionIds: result.convertedActionIds,
    behaviorFixtureIds: result.behaviorFixtureIds,
    unresolvedInteractions: result.unresolvedInteractions as FlowPlanInteraction[],
  };
}
