export const FIGMA_REST_POLICY_VERSION =
  "figma-rest-core-required-variables-optional-v1" as const;

export type FigmaRestCapabilityEvidence = {
  nodes?: {
    httpStatus?: number;
    readable?: boolean;
  };
  screenshot?: {
    httpStatus?: number;
    readable?: boolean;
  };
  assets?: {
    httpStatus?: number;
    readable?: boolean;
    imageCount?: number;
  };
  variables?: {
    httpStatus?: number;
    readable?: boolean;
  };
};

export type FigmaRestCapabilityClassification = {
  policyVersion: typeof FIGMA_REST_POLICY_VERSION;
  status:
    | "passed"
    | "passed_with_optional_variables_unavailable"
    | "failed";
  variablesCapability: "available" | "unavailable_optional";
  corePassed: boolean;
  m0Passed: boolean;
};

export function classifyFigmaRestEvidence(
  evidence: FigmaRestCapabilityEvidence,
): FigmaRestCapabilityClassification {
  const corePassed = Boolean(
    evidence.nodes?.readable &&
      evidence.screenshot?.readable &&
      evidence.assets?.readable,
  );
  const variablesCapability = evidence.variables?.readable
    ? "available"
    : "unavailable_optional";

  return {
    policyVersion: FIGMA_REST_POLICY_VERSION,
    status: corePassed
      ? evidence.variables?.readable
        ? "passed"
        : "passed_with_optional_variables_unavailable"
      : "failed",
    variablesCapability,
    corePassed,
    m0Passed: corePassed,
  };
}
