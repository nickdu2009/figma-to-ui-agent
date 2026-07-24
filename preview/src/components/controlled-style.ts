import type { CSSProperties } from "react";

export interface ControlledStyle {
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: "regular" | "medium" | "semibold" | "bold";
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
  NonNullable<ControlledStyle["fontWeight"]>,
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
  sm: "0 1px 2px rgb(32 36 42 / 12%)",
  md: "0 4px 12px rgb(32 36 42 / 16%)",
  lg: "0 12px 28px rgb(32 36 42 / 18%)",
};

export function controlledStyle(
  style?: ControlledStyle | null,
): CSSProperties | undefined {
  if (!style) {
    return undefined;
  }
  return {
    backgroundColor: style.backgroundColor,
    color: style.textColor,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight
      ? fontWeights[style.fontWeight]
      : undefined,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.textAlign,
    whiteSpace: style.whiteSpace,
    borderRadius: style.borderRadius,
    borderColor: style.borderColor,
    borderWidth: style.borderWidth,
    borderStyle:
      style.borderWidth !== undefined || style.borderColor
        ? "solid"
        : undefined,
    boxShadow: style.boxShadow ? boxShadows[style.boxShadow] : undefined,
    opacity: style.opacity,
    objectPosition: style.objectPosition,
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
