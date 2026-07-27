import type {
  NormalizedDesignValue,
  NormalizedNode,
  NormalizedStyle,
} from "../design-bundle/schema.ts";

export interface MappedStyle {
  backgroundColor?: string;
  backgroundImage?: string;
  textColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?:
    | "regular"
    | "medium"
    | "semibold"
    | "bold"
    | number;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?:
    | "left"
    | "center"
    | "right"
    | "justify";
  whiteSpace?:
    | "normal"
    | "nowrap"
    | "pre-line"
    | "pre-wrap";
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  boxShadow?: "none" | "sm" | "md" | "lg";
  opacity?: number;
  overflow?: "visible" | "hidden" | "auto";
}

type TextNode = NormalizedNode & { kind: "text" };

function colorToHex(value: {
  r: number;
  g: number;
  b: number;
  a?: number;
}): string {
  const toChannel = (channel: number) =>
    Math.round(channel * 255)
      .toString(16)
      .padStart(2, "0");
  const hex = `#${toChannel(value.r)}${toChannel(value.g)}${toChannel(value.b)}`;
  const alpha =
    value.a !== undefined && value.a < 1
      ? toChannel(value.a)
      : "";
  return `${hex}${alpha}`.toUpperCase();
}

function lightenHexColor(hex: string, amount: number): string {
  const match = hex.match(/^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i);
  if (!match) {
    return hex;
  }
  const channels = match.slice(1).map((channel) => Number.parseInt(channel, 16));
  const next = channels.map((channel) =>
    Math.round(channel + (255 - channel) * amount)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${next.join("")}`.toUpperCase();
}

function applyStyle(
  style: NormalizedStyle,
  target: MappedStyle,
  isText: boolean,
): void {
  if (style.kind === "color") {
    const color = colorToHex(style.value);
    if (isText) {
      target.textColor = color;
    } else {
      target.backgroundColor = color;
    }
  } else if (style.kind === "typography") {
    const value = style.value;
    target.fontFamily = fontFamilyWithFallback(value.fontFamily);
    target.fontSize = value.fontSize;
    target.fontWeight = mapFontWeight(value.fontWeight);
    if (value.lineHeight && value.fontSize > 0) {
      target.lineHeight = value.lineHeight / value.fontSize;
    }
    target.letterSpacing = value.letterSpacing;
  }
}

function fontFamilyWithFallback(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }
  const quoted = value.includes(" ") ? `"${value}"` : value;
  if (/(league spartan|spartan)/i.test(value)) {
    return `${quoted}, "Avenir Next Condensed", Avenir, "Helvetica Neue", Arial, sans-serif`;
  }
  if (/(poppins|montserrat|jakarta)/i.test(value)) {
    return `${quoted}, Avenir, "Avenir Next", "Helvetica Neue", Arial, sans-serif`;
  }
  if (/inter|roboto|helvetica/i.test(value)) {
    return `${quoted}, "Helvetica Neue", Arial, sans-serif`;
  }
  return `${quoted}, "Helvetica Neue", Arial, sans-serif`;
}

function mapFontWeight(
  weight: number | undefined,
): MappedStyle["fontWeight"] {
  if (weight === undefined) {
    return undefined;
  }
  return weight;
}

function mapTextAlign(
  align: string | undefined,
): MappedStyle["textAlign"] {
  switch (align?.toLowerCase()) {
    case "left":
      return "left";
    case "center":
      return "center";
    case "right":
      return "right";
    case "justify":
      return "justify";
    default:
      return undefined;
  }
}

function fillColorFromDesignValues(
  node: NormalizedNode,
  designValueMap: ReadonlyMap<string, NormalizedDesignValue>,
): string | undefined {
  for (const ref of node.designValueRefs) {
    const value = designValueMap.get(ref);
    if (value?.kind === "color" && value.name.startsWith("color.fill.")) {
      return colorToHex(value.value);
    }
  }
  return undefined;
}

export function mapTextStyle(node: TextNode): MappedStyle {
  const text = node.text;
  if (!text) {
    return {};
  }
  const hasExplicitLineBreak = /[\r\n]/.test(text.characters);
  const lineHeightRatio =
    text.lineHeight && text.fontSize && text.fontSize > 0
      ? text.lineHeight / text.fontSize
      : undefined;
  const lineHeightPx = text.lineHeight ?? text.fontSize;
  const isSingleLineTextBox =
    !hasExplicitLineBreak &&
    typeof node.bounds?.height === "number" &&
    typeof lineHeightPx === "number" &&
    node.bounds.height <= lineHeightPx * 1.4;
  const name = (node.name ?? "").toLowerCase();
  const forceNowrap =
    name.includes("footer") ||
    name.includes("copyright") ||
    isSingleLineTextBox ||
    (!node.bounds && !hasExplicitLineBreak && text.characters.length < 80);
  return {
    fontFamily: fontFamilyWithFallback(text.fontFamily),
    fontSize: text.fontSize,
    fontWeight: mapFontWeight(text.fontWeight),
    lineHeight: lineHeightRatio,
    letterSpacing: text.letterSpacing,
    textAlign: mapTextAlign(text.textAlign),
    whiteSpace: hasExplicitLineBreak
      ? "pre-line"
      : forceNowrap
        ? "nowrap"
        : "normal",
  };
}

export function mapNodeStyle(
  node: NormalizedNode,
  styles: readonly NormalizedStyle[],
  designValues: readonly NormalizedDesignValue[] = [],
): MappedStyle {
  const styleMap = new Map(styles.map((s) => [s.id, s]));
  const designValueMap = new Map(
    designValues.map((value) => [value.id, value]),
  );
  const isText = node.kind === "text";
  const mapped: MappedStyle = {};

  for (const styleRef of node.styleRefs) {
    const style = styleMap.get(styleRef);
    if (style) {
      applyStyle(style, mapped, isText);
    }
  }

  if (!mapped.textColor && isText && (node.visual?.fillCount ?? 0) > 0) {
    mapped.textColor = fillColorFromDesignValues(node, designValueMap);
  }

  if (!isText && (node.visual?.fillCount ?? 0) > 0) {
    mapped.backgroundColor =
      fillColorFromDesignValues(node, designValueMap) ??
      mapped.backgroundColor;
  }

  if (node.visual?.opacity !== undefined) {
    mapped.opacity = node.visual.opacity;
  }

  if (!isText && (node.visual?.strokeCount ?? 0) > 0) {
    mapped.borderWidth ??= node.visual?.strokeWeight ?? 1;
    mapped.borderColor ??= node.visual?.strokeColor
      ? colorToHex(node.visual.strokeColor)
      : "#EDF1F3";
  }

  if (!isText && node.visual?.cornerRadius !== undefined) {
    mapped.borderRadius ??= node.visual.cornerRadius;
  }

  if (
    !isText &&
    mapped.backgroundColor &&
    (node.visual?.fillCount ?? 0) > 1
  ) {
    mapped.backgroundImage = `linear-gradient(180deg, ${lightenHexColor(
      mapped.backgroundColor,
      0.11,
    )} 0%, ${mapped.backgroundColor} 100%)`;
  }

  if (!isText && (node.visual?.effectCount ?? 0) > 0) {
    mapped.boxShadow ??= "sm";
  }

  if (node.visual?.clipsContent) {
    mapped.overflow = "hidden";
  }

  if (node.kind === "text") {
    return { ...mapTextStyle(node as TextNode), ...mapped };
  }

  return mapped;
}

export function pickTextVariant(
  node: TextNode,
): "heading" | "body" | "label" | "caption" {
  const name = (node.name ?? "").toLowerCase();
  const text = node.text;
  const fontSize = text?.fontSize ?? 16;
  if (
    name.includes("title") ||
    name.includes("heading") ||
    fontSize >= 24
  ) {
    return "heading";
  }
  if (
    name.includes("label") ||
    name.includes("caption") ||
    fontSize <= 12
  ) {
    return name.includes("label") ? "label" : "caption";
  }
  return "body";
}

export { colorToHex };
