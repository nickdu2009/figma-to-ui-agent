import { z } from "zod";

import { projectIdSchema } from "../project-store/project-id.ts";
import { behaviorFixtureSchema } from "../ui-spec/schema.ts";

export const flowM8BehaviorScenarioSchema = z
  .object({
    schemaVersion: z.literal("1"),
    projectId: projectIdSchema,
    fixtures: z.array(behaviorFixtureSchema).max(1_000),
  })
  .strict();

export type FlowM8BehaviorScenario = z.infer<
  typeof flowM8BehaviorScenarioSchema
>;

export function parseFlowM8BehaviorScenario(
  raw: unknown,
): FlowM8BehaviorScenario {
  return flowM8BehaviorScenarioSchema.parse(raw);
}
