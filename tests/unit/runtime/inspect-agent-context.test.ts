import { describe, expect, it } from "vitest";

import { designBundleSchema } from "../../../src/design-bundle/schema.ts";
import { buildInspectAgentContext } from "../../../src/runtime/inspect-agent-context.ts";
import { createDesignBundleDraft } from "../../fixtures/contracts.ts";

describe("inspect Agent 上下文", () => {
  it("提供生成 UISpec 所需的脱敏节点、设计值和截图引用", () => {
    const draft = createDesignBundleDraft();
    draft.provenance = [
      {
        entityKind: "page",
        entityId: "page-home",
        origin: "figma_node",
        sourceIdHash: "c".repeat(64),
      },
    ];
    const bundle = designBundleSchema.parse({
      ...draft,
      revision: 1,
    });
    const context = buildInspectAgentContext(bundle);

    expect(context).toMatchObject({
      kind: "inspect_agent_context",
      projectId: "demo-project",
      designBundleRevision: 1,
      designValues: [
        {
          id: "color.background",
          origin: "inferred",
        },
      ],
    });
    expect(context.pages[0]).toMatchObject({
      id: "page-home",
      nodeCount: 2,
    });
    expect(context.pages[0]?.nodes[0]).toMatchObject({
      id: "figma-root",
      kind: "container",
    });
    expect(JSON.stringify(context)).not.toContain(
      bundle.source.fileKeyHash,
    );
  });
});
