import type { UISpec, UISpecDraft } from "../ui-spec/schema.ts";
import type { UnsupportedFeature } from "./contracts.ts";

type ScreenshotFeatureSource =
  | "schema_limit"
  | "validation_artifact";

export function collectScreenshotFallbackFeatures(
  uiSpec: UISpec | UISpecDraft,
  evidenceSource: ScreenshotFeatureSource,
): UnsupportedFeature[] {
  return uiSpec.nodes.flatMap((node) => {
    if (
      (node.kind !== "image" && node.kind !== "pixel_overlay") ||
      !node.assetRef.startsWith("figma/screenshots/")
    ) {
      return [];
    }
    return [
      {
        code: "screenshot_fallback_used",
        severity: "fallback_ok",
        evidenceSource,
        uiSpecNodeRefs: [node.id],
        impact: ["visual"],
        recommendedAction: "allow_local_fallback",
      },
    ];
  });
}
