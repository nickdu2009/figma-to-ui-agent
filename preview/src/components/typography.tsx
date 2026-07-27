import type { ComponentFn } from "@json-render/react";

import { previewCatalog } from "../../../src/preview/catalog.ts";
import { controlledStyle } from "./controlled-style.ts";

export const Text: ComponentFn<typeof previewCatalog, "Text"> = ({
  props,
}) => {
  const Tag = props.variant === "heading" ? "h1" : "p";
  const style = controlledStyle(props.style);
  const usesDisplayFallback =
    typeof style?.fontFamily === "string" &&
    /(didot|bodoni|times new roman|serif)/i.test(style.fontFamily);
  const defaultLineHeightByVariant = {
    heading: 1.2,
    body: 1.5,
    label: 1.2,
    caption: 1.2,
  } satisfies Record<typeof props.variant, number>;
  const lineHeight =
    typeof props.style?.fontSize === "number"
      ? props.style.fontSize *
        (props.style.lineHeight ??
          defaultLineHeightByVariant[props.variant])
      : undefined;
  const hasExplicitLineBreak = /[\r\n]/.test(props.text);
  const isSingleLineFrame =
    props.style?.position === "absolute" &&
    !hasExplicitLineBreak &&
    typeof props.style.height === "number" &&
    (lineHeight === undefined || props.style.height <= lineHeight * 1.4);
  const inferredWhiteSpace = hasExplicitLineBreak
    ? "pre-line"
    : isSingleLineFrame
      ? "nowrap"
      : undefined;
  const framedSingleLineHeight =
    isSingleLineFrame && typeof props.style?.height === "number"
      ? `${props.style.height}px`
      : undefined;
  const framedText = props.style?.position === "absolute";
  const visualOverlay = props.visualOverlay ?? null;
  const usePreciseTextRendering = usesDisplayFallback || framedText;
  const overlayImageStyle = visualOverlay
    ? {
        position: "absolute" as const,
        top: -visualOverlay.frame.y,
        left: -visualOverlay.frame.x,
        width: visualOverlay.sourceWidth,
        height: visualOverlay.sourceHeight,
        maxWidth: "none",
        pointerEvents: "none" as const,
      }
    : undefined;
  return (
    <Tag
      className={`ui-text ui-text-${props.variant}`}
      aria-label={visualOverlay ? props.text : undefined}
      data-ui-node-id={props.nodeId}
      style={{
        ...style,
        overflow: visualOverlay || framedText ? "hidden" : style?.overflow,
        WebkitFontSmoothing: usePreciseTextRendering
          ? "antialiased"
          : undefined,
        textRendering: usePreciseTextRendering
          ? "geometricPrecision"
          : undefined,
        lineHeight: framedSingleLineHeight ?? style?.lineHeight,
        whiteSpace: style?.whiteSpace ?? inferredWhiteSpace,
        color: visualOverlay ? "transparent" : style?.color,
      }}
    >
      {visualOverlay ? (
        <img
          src={visualOverlay.src}
          alt=""
          aria-hidden="true"
          style={overlayImageStyle}
        />
      ) : (
        props.text
      )}
    </Tag>
  );
};
