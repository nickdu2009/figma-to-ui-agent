import { describe, expect, it } from "vitest";

import type { NormalizedNode } from "../../../src/design-bundle/schema.ts";
import { mapPageNodes } from "../../../src/static-generation/node-mapper.ts";
import {
  mapNodeStyle,
  mapTextStyle,
} from "../../../src/static-generation/style-mapper.ts";
import { createM5StaticDesignBundle } from "../../fixtures/static-generation/m5-static-fixture.ts";

function textNode(
  overrides: Partial<Omit<NormalizedNode, "kind">> = {},
): NormalizedNode & { kind: "text" } {
  return {
    id: "text-1",
    name: "Label",
    visible: true,
    bounds: { x: 0, y: 0, width: 120, height: 20 },
    text: {
      characters: "Email label",
      fontFamily: "Inter",
      fontSize: 12,
      fontWeight: 500,
      lineHeight: 19.2,
      letterSpacing: -0.24,
      textAlign: "left",
    },
    styleRefs: [],
    imageRefs: [],
    boundVariableRefs: [],
    designValueRefs: [],
    warningCodes: [],
    ...overrides,
    kind: "text",
  };
}

describe("mapTextStyle", () => {
  it("maps complete Figma text metrics", () => {
    const style = mapTextStyle(textNode());
    expect(style).toMatchObject({
      fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
      fontSize: 12,
      fontWeight: 500,
      letterSpacing: -0.24,
      textAlign: "left",
      whiteSpace: "nowrap",
    });
    expect(style.lineHeight).toBeCloseTo(1.6);
  });

  it("adds closer local fallbacks for common geometric sans fonts", () => {
    const style = mapTextStyle(
      textNode({
        text: {
          characters: "Update Profile",
          fontFamily: "League Spartan",
          fontSize: 17,
          fontWeight: 600,
          lineHeight: 20,
          letterSpacing: -0.085,
          textAlign: "center",
        },
      }),
    );

    expect(style.fontFamily).toBe(
      '"League Spartan", "Avenir Next Condensed", Avenir, "Helvetica Neue", Arial, sans-serif',
    );
  });

  it("keeps geometric body fonts on non-condensed local fallbacks", () => {
    const style = mapTextStyle(
      textNode({
        text: {
          characters: "Madison Smith",
          fontFamily: "Poppins",
          fontSize: 17,
          fontWeight: 400,
          lineHeight: 24,
          letterSpacing: 0,
          textAlign: "left",
        },
      }),
    );

    expect(style.fontFamily).toBe(
      'Poppins, Avenir, "Avenir Next", "Helvetica Neue", Arial, sans-serif',
    );
  });

  it("keeps a tall single-line Figma text box nowrap", () => {
    const style = mapTextStyle(
      textNode({
        bounds: { x: 0, y: 0, width: 55, height: 19 },
        text: {
          characters: "Password",
          fontFamily: "Plus Jakarta Sans",
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 19.2,
          letterSpacing: -0.24,
          textAlign: "left",
        },
      }),
    );
    expect(style.whiteSpace).toBe("nowrap");
  });

  it("allows wrapping when a Figma text box is tall enough for multiple lines", () => {
    const style = mapTextStyle(
      textNode({
        bounds: { x: 0, y: 0, width: 327, height: 84 },
        text: {
          characters: "Sign in to your Account",
          fontFamily: "Inter",
          fontSize: 32,
          fontWeight: 700,
          lineHeight: 41.6,
          letterSpacing: -0.64,
          textAlign: "left",
        },
      }),
    );
    expect(style.whiteSpace).toBe("normal");
  });

  it("preserves explicit line breaks as pre-line", () => {
    const style = mapTextStyle(
      textNode({
        bounds: { x: 0, y: 0, width: 180, height: 56 },
        text: {
          characters: "Line one\nLine two",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 24,
          letterSpacing: 0,
          textAlign: "center",
        },
      }),
    );
    expect(style.whiteSpace).toBe("pre-line");
  });
});

describe("font weight mapping", () => {
  it("preserves source numeric weights instead of compressing to enum buckets", () => {
    for (const weight of [300, 400, 500, 600, 700]) {
      expect(
        mapTextStyle(
          textNode({
            text: {
              characters: `Weight ${weight}`,
              fontFamily: "Inter",
              fontSize: 16,
              fontWeight: weight,
              lineHeight: 20,
              letterSpacing: 0,
              textAlign: "left",
            },
          }),
        ).fontWeight,
      ).toBe(weight);
    }
  });
});

describe("mapNodeStyle", () => {
  it("maps inferred solid fill and clipsContent onto frame style", () => {
    const style = mapNodeStyle(
      {
        id: "frame-1",
        kind: "container",
        name: "Frame",
        visible: true,
        bounds: { x: 0, y: 0, width: 320, height: 240 },
        visual: {
          fillCount: 1,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
          clipsContent: true,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: ["color-fill-1"],
        warningCodes: [],
      },
      [],
      [
        {
          id: "color-fill-1",
          name: "color.fill.abc123",
          origin: "inferred",
          kind: "color",
          value: { r: 0.125, g: 0.25, b: 0.5, a: 1 },
        },
      ],
    );

    expect(style).toMatchObject({
      backgroundColor: "#204080",
      overflow: "hidden",
    });
  });

  it("maps inferred fill refs on text nodes as text color", () => {
    const style = mapNodeStyle(
      {
        ...textNode(),
        visual: {
          fillCount: 1,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
          clipsContent: false,
        },
        designValueRefs: ["color-fill-1"],
      },
      [],
      [
        {
          id: "color-fill-1",
          name: "color.fill.abc123",
          origin: "inferred",
          kind: "color",
          value: {
            r: 0.1921568661928177,
            g: 0.2235294133424759,
            b: 0.3019607961177826,
            a: 1,
          },
        },
      ],
    );

    expect(style.textColor).toBe("#31394D");
  });

  it("maps visible strokes and effects to DOM border and shadow hints", () => {
    const style = mapNodeStyle(
      {
        id: "field-frame",
        kind: "container",
        name: "Input Area",
        visible: true,
        bounds: { x: 0, y: 0, width: 320, height: 48 },
        visual: {
          fillCount: 1,
          strokeCount: 1,
          strokeWeight: 2,
          strokeColor: { r: 0.8, g: 0.7, b: 0.6, a: 0.5 },
          effectCount: 1,
          vectorPathCount: 0,
          cornerRadius: 12,
          clipsContent: true,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: ["color-fill-1"],
        warningCodes: [],
      },
      [],
      [
        {
          id: "color-fill-1",
          name: "color.fill.abc123",
          origin: "inferred",
          kind: "color",
          value: { r: 1, g: 1, b: 1, a: 1 },
        },
      ],
    );

    expect(style).toMatchObject({
      backgroundColor: "#FFFFFF",
      borderWidth: 2,
      borderColor: "#CCB39980",
      borderRadius: 12,
      boxShadow: "sm",
      overflow: "hidden",
    });
  });

  it("prefers explicit Figma fill values over color style refs on frames", () => {
    const style = mapNodeStyle(
      {
        id: "focused-input",
        kind: "container",
        name: "inputs-set",
        visible: true,
        bounds: { x: 0, y: 0, width: 189, height: 40 },
        visual: {
          fillCount: 1,
          strokeCount: 1,
          strokeWeight: 1,
          strokeColor: {
            r: 0.38837915658950806,
            g: 0.3789583444595337,
            b: 0.8500000238418579,
            a: 1,
          },
          effectCount: 0,
          vectorPathCount: 0,
          cornerRadius: 8,
          clipsContent: false,
        },
        styleRefs: ["accent-style"],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: ["transparent-fill"],
        warningCodes: [],
      },
      [
        {
          id: "accent-style",
          name: "$accent-tone-100",
          kind: "color",
          value: {
            r: 0.38837915658950806,
            g: 0.3789583444595337,
            b: 0.8500000238418579,
            a: 1,
          },
        },
      ],
      [
        {
          id: "transparent-fill",
          name: "color.fill.focused-input",
          origin: "inferred",
          kind: "color",
          value: {
            r: 0.33993056416511536,
            g: 0.37742480635643005,
            b: 0.4583333432674408,
            a: 0,
          },
        },
      ],
    );

    expect(style).toMatchObject({
      backgroundColor: "#57607500",
      borderColor: "#6361D9",
      borderWidth: 1,
      borderRadius: 8,
    });
  });

  it("approximates multi-fill frames with a constrained linear gradient", () => {
    const style = mapNodeStyle(
      {
        id: "primary-button",
        kind: "instance",
        name: "Button",
        visible: true,
        bounds: { x: 0, y: 0, width: 320, height: 48 },
        visual: {
          fillCount: 2,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
          clipsContent: true,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: ["button-fill"],
        warningCodes: [],
      },
      [],
      [
        {
          id: "button-fill",
          name: "color.fill.button",
          origin: "inferred",
          kind: "color",
          value: {
            r: 0.11252153664827347,
            g: 0.3820386528968811,
            b: 0.9052193760871887,
            a: 1,
          },
        },
      ],
    );

    expect(style).toMatchObject({
      backgroundColor: "#1D61E7",
      backgroundImage: "linear-gradient(180deg, #3672EA 0%, #1D61E7 100%)",
    });
  });

  it("does not map inferred fill refs on paintless grouping frames", () => {
    const style = mapNodeStyle(
      {
        id: "group-1",
        kind: "container",
        name: "Group",
        visible: true,
        bounds: { x: 0, y: 0, width: 320, height: 240 },
        visual: {
          fillCount: 0,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
          clipsContent: false,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: ["color-fill-1"],
        warningCodes: [],
      },
      [],
      [
        {
          id: "color-fill-1",
          name: "color.fill.abc123",
          origin: "inferred",
          kind: "color",
          value: { r: 1, g: 1, b: 1, a: 1 },
        },
      ],
    );

    expect(style.backgroundColor).toBeUndefined();
  });

});

describe("typography diagnostics", () => {
  it("warns when Figma text metrics are missing", () => {
    const bundle = createM5StaticDesignBundle();
    const title = bundle.pages[0]!.nodes.find(
      (node) => node.kind === "text",
    );
    if (title?.kind !== "text") {
      throw new Error("fixture text node not found");
    }
    title.text = {
      characters: title.text?.characters ?? "Title",
    };

    const result = mapPageNodes({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pagePath: "/login",
      visualLayers: [],
    });

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "typography_missing_font_family",
        }),
        expect.objectContaining({
          code: "typography_missing_font_size",
        }),
        expect.objectContaining({
          code: "typography_missing_line_height",
        }),
      ]),
    );
  });
});
