import type { CSSProperties } from "react";

export interface ControlledStyle {
  backgroundColor?: string;
  backgroundImage?: string;
  textColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: "regular" | "medium" | "semibold" | "bold" | number;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right" | "justify";
  whiteSpace?: "normal" | "nowrap" | "pre-line" | "pre-wrap";
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  boxShadow?: "none" | "sm" | "md" | "lg";
  opacity?: number;
  objectPosition?: string;
  overflow?: "visible" | "hidden" | "auto";
  pointerEvents?: "auto" | "none";
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  position?: "relative" | "absolute";
  left?: number;
  top?: number;
  zIndex?: number;
}

const fontWeights: Record<
  Exclude<NonNullable<ControlledStyle["fontWeight"]>, number>,
  CSSProperties["fontWeight"]
> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

const boxShadows: Record<
  NonNullable<ControlledStyle["boxShadow"]>,
  string
> = {
  none: "none",
  sm: "0 1px 2px rgb(16 24 40 / 6%)",
  md: "0 4px 12px rgb(32 36 42 / 16%)",
  lg: "0 12px 28px rgb(32 36 42 / 18%)",
};

export function controlledStyle(
  style?: ControlledStyle | null,
): CSSProperties | undefined {
  if (!style) {
    return undefined;
  }
  const visualBorder =
    style.borderColor &&
    style.borderWidth !== undefined &&
    style.borderWidth > 0
      ? `inset 0 0 0 ${style.borderWidth}px ${style.borderColor}`
      : undefined;
  const mappedShadow = style.boxShadow ? boxShadows[style.boxShadow] : undefined;
  const boxShadow =
    [mappedShadow, visualBorder].filter(Boolean).join(", ") || undefined;
  return {
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    color: style.textColor,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight
      ? typeof style.fontWeight === "number"
        ? style.fontWeight
        : fontWeights[style.fontWeight]
      : undefined,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.textAlign,
    whiteSpace: style.whiteSpace,
    borderRadius: style.borderRadius,
    boxShadow,
    opacity: style.opacity,
    objectPosition: style.objectPosition,
    overflow: style.overflow,
    pointerEvents: style.pointerEvents,
    width: style.width,
    height: style.height,
    minWidth: style.minWidth,
    minHeight: style.minHeight,
    maxWidth: style.maxWidth,
    maxHeight: style.maxHeight,
    position: style.position,
    left: style.left,
    top: style.top,
    zIndex: style.zIndex,
  };
}
