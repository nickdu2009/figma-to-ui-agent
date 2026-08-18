import { describe, expect, it } from "vitest";

import { normalizedDesignValueSchema } from "../../../src/design-bundle/schema.ts";
import { normalizeFigmaDocument } from "../../../src/figma/normalize.ts";
import { FigmaRestError } from "../../../src/figma/rest-client.ts";
import {
  applyNodeDesignValueRefs,
  classifyVariablesUnavailable,
  extractFigmaVariables,
  inferDesignValuesFromBindings,
  inferRepeatedDesignValues,
} from "../../../src/figma/variables.ts";
import { createFigmaFileResponseFixture } from "../../fixtures/figma/file-response.ts";
import { createFigmaVariablesResponseFixture } from "../../fixtures/figma/variables-response.ts";

describe("Figma Variables 标准化", () => {
  it("保留 Figma 名称、集合、模式、代码语法和别名来源", () => {
    const normalized = normalizeFigmaDocument(
      createFigmaFileResponseFixture(),
    );
    const extracted = extractFigmaVariables(
      createFigmaVariablesResponseFixture(),
      normalized.bindingObservations,
    );

    expect(extracted.capability).toEqual({
      status: "available",
      variableCount: 3,
      collectionCount: 1,
    });
    const fontSize = extracted.designValues.find(
      (value) => value.name === "Typography / Body Size",
    );
    expect(fontSize).toMatchObject({
      kind: "number",
      value: 32,
      origin: "figma_variable",
      collection: { name: "Primitives" },
      codeSyntax: {
        web: "var(--body-size)",
        android: "body_size",
        ios: "bodySize",
      },
      modes: [
        { name: "Light", value: 32 },
        { name: "Dark", value: 34 },
      ],
    });
    const surface = extracted.designValues.find(
      (value) => value.name === "Color / Surface",
    );
    expect(surface?.modes?.[1]).toMatchObject({
      name: "Dark",
      value: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
      aliasTargetRefHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    extracted.designValues.forEach((value) => {
      expect(() => normalizedDesignValueSchema.parse(value)).not.toThrow();
      expect(JSON.stringify(value)).not.toContain("VariableID:");
      expect(JSON.stringify(value)).not.toContain("Mode:");
      expect(JSON.stringify(value)).not.toContain("VariableCollection:");
    });

    const titleRefs = extracted.nodeDesignValueRefs.get("1:2");
    expect(titleRefs).toEqual([fontSize?.id]);
    expect(
      applyNodeDesignValueRefs(
        normalized.pages,
        extracted.nodeDesignValueRefs,
      )[0]!.nodes.find((node) => node.id === "1:2")
        ?.designValueRefs,
    ).toEqual([fontSize?.id]);
  });

  it("别名循环只跳过受影响变量且不暴露原始 ID", () => {
    const response = createFigmaVariablesResponseFixture();
    const meta = response.meta as {
      variables: Record<string, unknown>;
    };
    meta.variables = {
      "VariableID:a": {
        id: "VariableID:a",
        name: "A",
        variableCollectionId: "VariableCollection:primitives",
        resolvedType: "FLOAT",
        valuesByMode: {
          "Mode:light": {
            type: "VARIABLE_ALIAS",
            id: "VariableID:b",
          },
        },
      },
      "VariableID:b": {
        id: "VariableID:b",
        name: "B",
        variableCollectionId: "VariableCollection:primitives",
        resolvedType: "FLOAT",
        valuesByMode: {
          "Mode:light": {
            type: "VARIABLE_ALIAS",
            id: "VariableID:a",
          },
        },
      },
    };

    const extracted = extractFigmaVariables(response);
    expect(extracted.designValues).toEqual([]);
    expect(extracted.warnings).toHaveLength(2);
    expect(extracted.warnings[0]).toMatchObject({
      code: "alias_cycle",
      entityId: expect.stringMatching(
        /^figma_variable\.[a-f0-9]{64}$/,
      ),
    });
    expect(JSON.stringify(extracted)).not.toContain("VariableID:");
  });

  it("401/403 只降级 Variables，其他错误保持核心失败", () => {
    expect(
      classifyVariablesUnavailable(
        new FigmaRestError("http_error", "清洗错误", {
          status: 401,
        }),
      ),
    ).toEqual({
      status: "unavailable_optional",
      reasonCode: "unauthorized",
    });
    expect(
      classifyVariablesUnavailable(
        new FigmaRestError("http_error", "清洗错误", {
          status: 403,
        }),
      ),
    ).toEqual({
      status: "unavailable_optional",
      reasonCode: "unknown",
    });
    expect(
      classifyVariablesUnavailable(
        new FigmaRestError("http_error", "清洗错误", {
          status: 500,
        }),
      ),
    ).toBeUndefined();
  });
});

describe("Variables 不可用时的设计值回退", () => {
  it("优先从绑定实值生成脱敏设计值和节点引用", () => {
    const normalized = normalizeFigmaDocument(
      createFigmaFileResponseFixture(),
    );
    const inferred = inferDesignValuesFromBindings(
      normalized.bindingObservations,
    );

    expect(inferred.designValues).toEqual([
      expect.objectContaining({
        name: "number.binding.1",
        kind: "number",
        value: 32,
        origin: "inferred_from_binding",
        sourceRefHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(inferred.nodeDesignValueRefs.get("1:2")).toEqual([
      inferred.designValues[0]!.id,
    ]);
    expect(JSON.stringify(inferred)).not.toContain(
      "VariableID:font-size",
    );
  });

  it("无绑定时只把至少两个节点重复使用的值纳入推导", () => {
    const fixture = createFigmaFileResponseFixture();
    const document = fixture.document as {
      children: Array<{
        children: Array<Record<string, unknown>>;
      }>;
    };
    document.children[0]!.children.push({
      id: "1:9",
      name: "Repeated spacing",
      type: "FRAME",
      itemSpacing: 24,
      paddingTop: 32,
      children: [],
    });
    const normalized = normalizeFigmaDocument(fixture);
    const inferred = inferRepeatedDesignValues(
      normalized.pages,
      normalized.styles,
    );

    expect(inferred.designValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "number.spacing.1",
          value: 24,
          origin: "inferred",
        }),
        expect.objectContaining({
          name: "number.spacing.2",
          value: 32,
          origin: "inferred",
        }),
      ]),
    );
    expect(inferred.designValues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 700 }),
      ]),
    );
  });
});
