import { z } from "zod";

import type { RenderAndCompareInput } from "../tools/contracts.ts";
import type { UISpecDraft } from "../ui-spec/schema.ts";

const viewportSchema = z
  .object({
    id: z.string().min(1).max(128),
    width: z.number().int().min(240).max(10_000),
    height: z.number().int().min(240).max(10_000),
    deviceScaleFactor: z.number().positive().max(8),
  })
  .strict();

const comparisonSchema = z
  .object({
    maxDiffPixelRatio: z.number().min(0).max(1),
    maxDiffPixels: z.number().int().nonnegative(),
    timeoutMs: z.number().int().min(1_000).max(120_000),
  })
  .strict();

export const frozenRunPolicySchema = z
  .object({
    schemaVersion: z.literal("1"),
    baselineId: z.string().regex(/^[a-f0-9]{64}$/),
    viewports: z.array(viewportSchema).min(1).max(100),
    comparison: comparisonSchema,
  })
  .strict()
  .superRefine((policy, ctx) => {
    const ids = new Set<string>();
    policy.viewports.forEach((viewport, index) => {
      if (ids.has(viewport.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["viewports", index, "id"],
          message: `重复冻结视口：${viewport.id}`,
        });
      }
      ids.add(viewport.id);
    });
  });

export type FrozenRunPolicy = z.infer<
  typeof frozenRunPolicySchema
>;

function sameViewports(
  actual: UISpecDraft["viewports"],
  expected: FrozenRunPolicy["viewports"],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((viewport, index) => {
      const frozen = expected[index];
      return (
        frozen !== undefined &&
        viewport.id === frozen.id &&
        viewport.width === frozen.width &&
        viewport.height === frozen.height &&
        viewport.deviceScaleFactor ===
          frozen.deviceScaleFactor
      );
    })
  );
}

export function loadFrozenRunPolicy(
  env: NodeJS.ProcessEnv = process.env,
): FrozenRunPolicy | undefined {
  const raw = env.M3_FROZEN_POLICY_JSON;
  if (raw === undefined) {
    return undefined;
  }
  if (Buffer.byteLength(raw, "utf8") > 64 * 1024) {
    throw new Error("m3_frozen_policy_invalid:too_large");
  }
  try {
    return frozenRunPolicySchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new Error("m3_frozen_policy_invalid", {
      cause: error,
    });
  }
}

export function assertFrozenUISpec(
  policy: FrozenRunPolicy | undefined,
  uiSpec: UISpecDraft,
): void {
  if (!policy) {
    return;
  }
  if (!sameViewports(uiSpec.viewports, policy.viewports)) {
    throw new Error(
      "m3_frozen_policy_violation:ui_spec_viewports",
    );
  }
}

export function assertFrozenRenderInput(
  policy: FrozenRunPolicy | undefined,
  input: RenderAndCompareInput,
): void {
  if (!policy) {
    return;
  }
  const expectedViewportIds = policy.viewports.map(
    (viewport) => viewport.id,
  );
  if (
    input.viewportIds === undefined ||
    input.viewportIds.length !== expectedViewportIds.length ||
    input.viewportIds.some(
      (viewportId, index) =>
        viewportId !== expectedViewportIds[index],
    )
  ) {
    throw new Error(
      "m3_frozen_policy_violation:render_viewports",
    );
  }
  if (
    input.comparison.maxDiffPixelRatio !==
      policy.comparison.maxDiffPixelRatio ||
    input.comparison.maxDiffPixels !==
      policy.comparison.maxDiffPixels ||
    input.comparison.timeoutMs !==
      policy.comparison.timeoutMs
  ) {
    throw new Error(
      "m3_frozen_policy_violation:comparison",
    );
  }
}
