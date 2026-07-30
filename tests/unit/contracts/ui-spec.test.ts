import { describe, expect, it } from "vitest";

import { uiSpecDraftSchema } from "../../../src/ui-spec/schema.ts";
import {
  FIXTURE_ASSET_PATH,
  createUISpecDraft,
} from "../../fixtures/contracts.ts";

describe("UISpec Schema", () => {
  it("接受受控组件、动作、视口和行为夹具", () => {
    const parsed = uiSpecDraftSchema.parse(createUISpecDraft());
    expect(parsed).toMatchObject({
      schemaVersion: "1",
      catalogVersion: "1",
      sourceDesignBundleRevision: 1,
    });
    expect(
      parsed.nodes.find((node) => node.kind === "button"),
    ).not.toHaveProperty("disabled");
  });

  it("sourceFlowPlanRevision 是可选追溯字段且必须为正整数", () => {
    expect(
      uiSpecDraftSchema.parse(createUISpecDraft()),
    ).not.toHaveProperty("sourceFlowPlanRevision");

    const traced = createUISpecDraft();
    traced.sourceFlowPlanRevision = 3;
    expect(uiSpecDraftSchema.parse(traced)).toMatchObject({
      sourceFlowPlanRevision: 3,
    });

    const invalid = createUISpecDraft() as unknown as {
      sourceFlowPlanRevision: number;
    };
    invalid.sourceFlowPlanRevision = 0;
    expect(() => uiSpecDraftSchema.parse(invalid)).toThrow();
  });

  it("支持三类交互控件的可选静态禁用状态", () => {
    const draft = createUISpecDraft();
    const button = draft.nodes.find(
      (node) => node.kind === "button",
    );
    if (button?.kind === "button") {
      button.disabled = true;
    }
    draft.state.push(
      {
        key: "email",
        valueType: "string",
        initialValue: "",
      },
      {
        key: "accepted",
        valueType: "boolean",
        initialValue: false,
      },
    );
    draft.nodes.push(
      {
        id: "email",
        kind: "input",
        label: "邮箱",
        stateKey: "email",
        inputType: "email",
        disabled: true,
        designValueRefs: [],
      },
      {
        id: "accepted",
        kind: "checkbox",
        label: "接受",
        stateKey: "accepted",
        disabled: true,
        designValueRefs: [],
      },
    );
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("email", "accepted");
    }

    const parsed = uiSpecDraftSchema.parse(draft);
    expect(
      parsed.nodes
        .filter(
          (node) =>
            node.kind === "button" ||
            node.kind === "input" ||
            node.kind === "checkbox",
        )
        .map((node) => node.disabled),
    ).toEqual([true, true, true]);
  });

  it("支持表单行为断言 expect_value 和 expect_checked", () => {
    const draft = createUISpecDraft();
    draft.state.push(
      {
        key: "email",
        valueType: "string",
        initialValue: "",
      },
      {
        key: "accepted",
        valueType: "boolean",
        initialValue: false,
      },
    );
    draft.nodes.push(
      {
        id: "email",
        kind: "input",
        label: "邮箱",
        stateKey: "email",
        inputType: "email",
        designValueRefs: [],
      },
      {
        id: "accepted",
        kind: "checkbox",
        label: "接受",
        stateKey: "accepted",
        designValueRefs: [],
      },
    );
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("email", "accepted");
    }
    draft.behaviorFixtures.push({
      id: "form-assertions",
      name: "表单断言",
      viewportId: "desktop",
      initialPageId: "home",
      steps: [
        { kind: "fill", nodeId: "email", value: "tester@example.com" },
        {
          kind: "expect_value",
          nodeId: "email",
          value: "tester@example.com",
        },
        { kind: "toggle", nodeId: "accepted" },
        { kind: "expect_checked", nodeId: "accepted", checked: true },
      ],
    });

    const parsed = uiSpecDraftSchema.parse(draft);
    expect(parsed.behaviorFixtures.at(-1)?.steps).toEqual([
      { kind: "fill", nodeId: "email", value: "tester@example.com" },
      {
        kind: "expect_value",
        nodeId: "email",
        value: "tester@example.com",
      },
      { kind: "toggle", nodeId: "accepted" },
      { kind: "expect_checked", nodeId: "accepted", checked: true },
    ]);
  });

  it("支持 Flow-M8 submit action 和 select/radio 行为断言", () => {
    const draft = createUISpecDraft();
    draft.state.push(
      {
        key: "status",
        valueType: "string",
        initialValue: "idle",
      },
      {
        key: "plan",
        valueType: "string",
        initialValue: "",
      },
      {
        key: "role",
        valueType: "string",
        initialValue: "",
      },
    );
    draft.nodes.push(
      {
        id: "status-text",
        kind: "text",
        text: "正在审核",
        variant: "body",
        visibleWhen: {
          stateKey: "status",
          equals: "review",
        },
        designValueRefs: [],
      },
      {
        id: "plan-select",
        kind: "select",
        label: "套餐",
        stateKey: "plan",
        options: [{ value: "pro", label: "Pro" }],
        designValueRefs: [],
      },
      {
        id: "role-admin",
        kind: "radio",
        label: "管理员",
        stateKey: "role",
        value: "admin",
        designValueRefs: [],
      },
    );
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("status-text", "plan-select", "role-admin");
    }
    const button = draft.nodes.find((node) => node.kind === "button");
    if (button?.kind === "button") {
      button.actionId = "submit-review";
    }
    draft.actions.push({
      id: "submit-review",
      kind: "submit",
      effect: {
        kind: "set_state",
        stateKey: "status",
        value: "review",
      },
      postconditions: [
        {
          kind: "expect_visible",
          nodeId: "status-text",
        },
      ],
    });
    draft.behaviorFixtures.push({
      id: "m8-select-radio",
      name: "M8 选择控件",
      viewportId: "desktop",
      initialPageId: "home",
      steps: [
        { kind: "select_option", nodeId: "plan-select", value: "pro" },
        { kind: "expect_selected", nodeId: "plan-select", value: "pro" },
        { kind: "choose_radio", nodeId: "role-admin", value: "admin" },
        { kind: "expect_selected", nodeId: "role-admin", value: "admin" },
      ],
    });

    const parsed = uiSpecDraftSchema.parse(draft);
    expect(parsed.actions.at(-1)).toMatchObject({
      kind: "submit",
      effect: { kind: "set_state", stateKey: "status", value: "review" },
    });
    expect(parsed.behaviorFixtures.at(-1)?.steps).toEqual(
      expect.arrayContaining([
        { kind: "expect_selected", nodeId: "plan-select", value: "pro" },
        { kind: "expect_selected", nodeId: "role-admin", value: "admin" },
      ]),
    );
  });

  it("拒绝缺少 postcondition 的 Flow-M8 submit action", () => {
    const draft = createUISpecDraft();
    const button = draft.nodes.find((node) => node.kind === "button");
    if (button?.kind === "button") {
      button.actionId = "submit-review";
    }
    draft.actions.push({
      id: "submit-review",
      kind: "submit",
      effect: { kind: "none" },
      postconditions: [],
    });

    expect(() => uiSpecDraftSchema.parse(draft)).toThrow();
  });

  it("支持 button 图标资产和 pixel_overlay 节点", () => {
    const draft = createUISpecDraft();
    const button = draft.nodes.find(
      (node) => node.kind === "button",
    );
    if (button?.kind === "button") {
      button.leadingIconAssetRef = FIXTURE_ASSET_PATH;
      button.trailingIconAssetRef = FIXTURE_ASSET_PATH;
    }
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("overlay");
    }
    draft.nodes.push({
      id: "overlay",
      kind: "pixel_overlay",
      assetRef: FIXTURE_ASSET_PATH,
      alt: "局部覆盖层",
      width: 320,
      height: 180,
      childIds: [],
      designValueRefs: [],
    });

    const parsed = uiSpecDraftSchema.parse(draft);
    expect(
      parsed.nodes.find((node) => node.kind === "button"),
    ).toMatchObject({
      leadingIconAssetRef: FIXTURE_ASSET_PATH,
      trailingIconAssetRef: FIXTURE_ASSET_PATH,
    });
    expect(
      parsed.nodes.find((node) => node.kind === "pixel_overlay"),
    ).toMatchObject({ width: 320, height: 180 });
  });

  it("支持受控基础样式并拒绝任意 CSS", () => {
    const draft = createUISpecDraft();
    draft.nodes[1]!.style = {
      backgroundColor: "#ffffff",
      backgroundImage: "linear-gradient(180deg, #ffffff 0%, #eeeeee 100%)",
      textColor: "#123456",
      fontFamily: "Inter, Arial, sans-serif",
      fontSize: 24,
      fontWeight: 350,
      lineHeight: 1.4,
      letterSpacing: 0.4,
      textAlign: "center",
      whiteSpace: "nowrap",
      borderRadius: 8,
      borderColor: "#abcdef",
      borderWidth: 1,
      boxShadow: "md",
      opacity: 0.85,
      objectPosition: "50% 50%",
      pointerEvents: "none",
      width: 320,
      minHeight: 40,
      maxWidth: 640,
      position: "absolute",
      left: 24,
      top: 48,
      zIndex: 2,
    };

    expect(uiSpecDraftSchema.parse(draft).nodes[1]).toMatchObject({
      style: {
        backgroundColor: "#ffffff",
        backgroundImage: "linear-gradient(180deg, #ffffff 0%, #eeeeee 100%)",
        textColor: "#123456",
        fontFamily: "Inter, Arial, sans-serif",
        fontWeight: 350,
        letterSpacing: 0.4,
        textAlign: "center",
        whiteSpace: "nowrap",
        boxShadow: "md",
        opacity: 0.85,
        objectPosition: "50% 50%",
        pointerEvents: "none",
        position: "absolute",
        left: 24,
        top: 48,
        zIndex: 2,
      },
    });

    const invalid = createUISpecDraft() as unknown as {
      nodes: Array<Record<string, unknown>>;
    };
    invalid.nodes[1]!.style = {
      position: "absolute",
      color: "red",
    };
    expect(() => uiSpecDraftSchema.parse(invalid)).toThrow();
  });

  it("拒绝非法基础样式值", () => {
    const invalidColor = createUISpecDraft() as unknown as {
      nodes: Array<Record<string, unknown>>;
    };
    invalidColor.nodes[1]!.style = { textColor: "red" };
    expect(() => uiSpecDraftSchema.parse(invalidColor)).toThrow();

    const invalidShadow = createUISpecDraft() as unknown as {
      nodes: Array<Record<string, unknown>>;
    };
    invalidShadow.nodes[1]!.style = { boxShadow: "xl" };
    expect(() => uiSpecDraftSchema.parse(invalidShadow)).toThrow();

    const invalidBackgroundImage = createUISpecDraft() as unknown as {
      nodes: Array<Record<string, unknown>>;
    };
    invalidBackgroundImage.nodes[1]!.style = {
      backgroundImage: "url(https://example.com/image.png)",
    };
    expect(() => uiSpecDraftSchema.parse(invalidBackgroundImage)).toThrow();

    const invalidWeight = createUISpecDraft() as unknown as {
      nodes: Array<Record<string, unknown>>;
    };
    invalidWeight.nodes[1]!.style = { fontWeight: 0 };
    expect(() => uiSpecDraftSchema.parse(invalidWeight)).toThrow();
  });

  it("拒绝非法禁用值和非交互节点上的禁用字段", () => {
    const invalidBoolean = createUISpecDraft() as unknown as {
      nodes: Array<Record<string, unknown>>;
    };
    invalidBoolean.nodes.find(
      (node) => node.kind === "button",
    )!.disabled = "yes";
    expect(() => uiSpecDraftSchema.parse(invalidBoolean)).toThrow();

    const invalidTarget = createUISpecDraft() as unknown as {
      nodes: Array<Record<string, unknown>>;
    };
    invalidTarget.nodes.find(
      (node) => node.kind === "text",
    )!.disabled = false;
    expect(() => uiSpecDraftSchema.parse(invalidTarget)).toThrow();
  });

  it("拒绝外部 URL、任意 CSS 和事件处理器", () => {
    expect(() =>
      uiSpecDraftSchema.parse({
        ...createUISpecDraft(),
        pages: [
          {
            id: "home",
            sourcePageId: "page-home",
            path: "https://example.com",
            title: "外部页面",
            rootNodeId: "root",
          },
        ],
      }),
    ).toThrow();

    const withArbitraryFields = createUISpecDraft() as unknown as {
      nodes: Array<Record<string, unknown>>;
    };
    withArbitraryFields.nodes[1]!.unsafeStyle = { color: "red" };
    withArbitraryFields.nodes[1]!.onClick = "runScript()";
    expect(() => uiSpecDraftSchema.parse(withArbitraryFields)).toThrow();

    const invalidIcon = createUISpecDraft() as unknown as {
      nodes: Array<Record<string, unknown>>;
    };
    invalidIcon.nodes.find(
      (node) => node.kind === "button",
    )!.leadingIconAssetRef = "https://example.com/icon.png";
    expect(() => uiSpecDraftSchema.parse(invalidIcon)).toThrow();
  });

  it("拒绝悬空节点、动作和设计值引用", () => {
    const draft = createUISpecDraft();
    draft.pages[0]!.rootNodeId = "missing-root";
    const button = draft.nodes.find((node) => node.kind === "button");
    if (button?.kind === "button") {
      button.actionId = "missing-action";
      button.designValueRefs = ["missing-value"];
    }

    const result = uiSpecDraftSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain("悬空页面根节点引用：missing-root");
      expect(messages).toContain("悬空动作引用：missing-action");
      expect(messages).toContain(
        "节点引用了未声明的设计值：missing-value",
      );
    }
  });

  it("允许 Stack 和 Switch 绑定动作并作为行为夹具点击目标", () => {
    const draft = createUISpecDraft();
    draft.actions.push({
      id: "set-active",
      kind: "set_state",
      stateKey: "active",
      value: "target",
    });
    draft.state.push(
      {
        key: "active",
        valueType: "string",
        initialValue: "source",
      },
      {
        key: "enabled",
        valueType: "boolean",
        initialValue: false,
      },
    );
    draft.nodes.push(
      {
        id: "clickable-stack",
        kind: "stack",
        direction: "vertical",
        childIds: [],
        actionId: "set-active",
        designValueRefs: [],
      },
      {
        id: "toggle-source",
        kind: "switch",
        label: "切换",
        stateKey: "enabled",
        actionId: "set-active",
        designValueRefs: [],
      },
    );
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("clickable-stack", "toggle-source");
    }
    draft.behaviorFixtures.push({
      id: "stack-click",
      name: "Stack 点击",
      viewportId: "desktop",
      initialPageId: "home",
      steps: [
        { kind: "click", nodeId: "clickable-stack" },
        { kind: "click", nodeId: "toggle-source" },
      ],
    });

    const parsed = uiSpecDraftSchema.parse(draft);

    expect(parsed.nodes.find((node) => node.id === "clickable-stack")).toMatchObject({
      actionId: "set-active",
    });
    expect(parsed.nodes.find((node) => node.id === "toggle-source")).toMatchObject({
      actionId: "set-active",
    });
  });

  it("拒绝 Stack 和 Switch 悬空动作引用", () => {
    const draft = createUISpecDraft();
    draft.state.push({
      key: "enabled",
      valueType: "boolean",
      initialValue: false,
    });
    draft.nodes.push(
      {
        id: "clickable-stack",
        kind: "stack",
        direction: "vertical",
        childIds: [],
        actionId: "missing-action",
        designValueRefs: [],
      },
      {
        id: "toggle-source",
        kind: "switch",
        label: "切换",
        stateKey: "enabled",
        actionId: "missing-action",
        designValueRefs: [],
      },
    );
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("clickable-stack", "toggle-source");
    }

    const result = uiSpecDraftSchema.safeParse(draft);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.filter(
          (issue) => issue.message === "悬空动作引用：missing-action",
        ),
      ).toHaveLength(2);
    }
  });

  it("拒绝循环、多个父节点和不可达节点", () => {
    const draft = createUISpecDraft();
    const root = draft.nodes[0]!;
    if (root.kind === "stack") {
      root.childIds.push("root");
      root.childIds.push("second-parent");
    }
    draft.nodes.push({
      id: "second-parent",
      kind: "stack",
      direction: "vertical",
      childIds: ["title"],
      designValueRefs: [],
    });
    draft.nodes.push({
      id: "orphan",
      kind: "divider",
      designValueRefs: [],
    });

    const result = uiSpecDraftSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("节点图存在循环"),
        ),
      ).toBe(true);
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("节点必须从且只能从一个页面根节点可达"),
        ),
      ).toBe(true);
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("节点不能有多个父节点"),
        ),
      ).toBe(true);
    }
  });

  it("拒绝不匹配的状态类型", () => {
    const draft = createUISpecDraft();
    draft.state.push({
      key: "accepted",
      valueType: "string",
      initialValue: "no",
    });
    draft.nodes.push({
      id: "accepted-checkbox",
      kind: "checkbox",
      label: "接受",
      stateKey: "accepted",
      designValueRefs: [],
    });
    const root = draft.nodes[0]!;
    if (root.kind === "stack") {
      root.childIds.push("accepted-checkbox");
    }

    expect(() => uiSpecDraftSchema.parse(draft)).toThrow(
      "复选框、开关和对话框必须引用布尔状态",
    );
  });

  it("支持条件可见性并拒绝状态类型不匹配", () => {
    const draft = createUISpecDraft();
    draft.state.push({
      key: "variant",
      valueType: "string",
      initialValue: "source",
    });
    const target = draft.nodes.find((node) => node.id === "title");
    if (target) {
      target.visibleWhen = {
        stateKey: "variant",
        equals: "target",
      };
    }
    expect(uiSpecDraftSchema.parse(draft).nodes[1]).toMatchObject({
      visibleWhen: {
        stateKey: "variant",
        equals: "target",
      },
    });

    const invalid = structuredClone(draft);
    const invalidTarget = invalid.nodes.find((node) => node.id === "title");
    if (invalidTarget) {
      invalidTarget.visibleWhen = {
        stateKey: "variant",
        equals: true,
      };
    }
    expect(() => uiSpecDraftSchema.parse(invalid)).toThrow(
      "条件可见性引用不存在或值类型不匹配",
    );
  });

  it("拒绝行为步骤与目标组件类型不匹配", () => {
    const draft = createUISpecDraft();
    draft.behaviorFixtures[0]!.steps = [
      { kind: "fill", nodeId: "title", value: "错误目标" },
    ];

    expect(() => uiSpecDraftSchema.parse(draft)).toThrow(
      "行为 fill 与目标组件 text 不兼容",
    );
  });

  it("支持 P1 表单与内容/导航组件", () => {
    const draft = createUISpecDraft();
    draft.state.push(
      { key: "plan", valueType: "string", initialValue: "basic" },
      { key: "notify", valueType: "boolean", initialValue: false },
      { key: "bio", valueType: "string", initialValue: "" },
      { key: "country", valueType: "string", initialValue: "" },
      { key: "activeTab", valueType: "string", initialValue: "general" },
    );
    draft.actions.push({
      id: "go-home",
      kind: "navigate",
      pageId: "home",
    });
    draft.nodes.push(
      {
        id: "terms-link",
        kind: "link",
        label: "条款",
        actionId: "go-home",
        designValueRefs: [],
      },
      {
        id: "plan-radio",
        kind: "radio",
        label: "基础版",
        stateKey: "plan",
        value: "basic",
        designValueRefs: [],
      },
      {
        id: "notify-switch",
        kind: "switch",
        label: "通知",
        stateKey: "notify",
        designValueRefs: [],
      },
      {
        id: "country-select",
        kind: "select",
        label: "国家",
        stateKey: "country",
        options: [{ value: "cn", label: "中国" }],
        sourceComponent: {
          componentRef: "figma-component-select",
          family: "select",
          state: "selected",
          variantProperties: {
            State: "Selected",
            Size: "Medium",
          },
        },
        designValueRefs: [],
      },
      {
        id: "bio-textarea",
        kind: "textarea",
        label: "简介",
        stateKey: "bio",
        designValueRefs: [],
      },
      {
        id: "name-field",
        kind: "form_field",
        label: "姓名",
        required: true,
        childIds: ["bio-textarea"],
        designValueRefs: [],
      },
      {
        id: "avatar",
        kind: "avatar",
        initials: "JD",
        alt: "用户头像",
        designValueRefs: [],
      },
      {
        id: "icon",
        kind: "icon",
        assetRef: FIXTURE_ASSET_PATH,
        decorative: true,
        designValueRefs: [],
      },
      {
        id: "spacer",
        kind: "spacer",
        width: 16,
        designValueRefs: [],
      },
      {
        id: "card",
        kind: "card",
        childIds: ["avatar"],
        designValueRefs: [],
      },
      {
        id: "list",
        kind: "list",
        childIds: [],
        designValueRefs: [],
      },
      {
        id: "badge",
        kind: "badge",
        label: "新",
        tone: "success",
        designValueRefs: [],
      },
      {
        id: "tabs",
        kind: "tabs",
        stateKey: "activeTab",
        tabs: [
          { value: "general", label: "常规", childIds: [] },
          { value: "advanced", label: "高级", childIds: [] },
        ],
        designValueRefs: [],
      },
      {
        id: "nav",
        kind: "nav",
        orientation: "horizontal",
        childIds: [],
        designValueRefs: [],
      },
    );
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push(
        "terms-link",
        "plan-radio",
        "notify-switch",
        "country-select",
        "name-field",
        "card",
        "list",
        "badge",
        "tabs",
        "nav",
        "icon",
        "spacer",
      );
    }

    const parsed = uiSpecDraftSchema.parse(draft);
    expect(parsed.nodes.find((node) => node.kind === "tabs")?.tabs).toHaveLength(
      2,
    );
    expect(
      parsed.nodes.find((node) => node.kind === "select")?.options,
    ).toHaveLength(1);
  });

  it("支持受控 symbol icon 且拒绝缺少视觉来源的 icon", () => {
    const draft = createUISpecDraft();
    draft.nodes.push({
      id: "chevron",
      kind: "icon",
      symbol: "plus",
      decorative: true,
      designValueRefs: [],
    });
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("chevron");
    }
    const parsed = uiSpecDraftSchema.parse(draft);
    expect(parsed.nodes.find((node) => node.id === "chevron")).toMatchObject({
      kind: "icon",
      symbol: "plus",
    });

    const invalid = createUISpecDraft();
    invalid.nodes.push({
      id: "empty-icon",
      kind: "icon",
      decorative: true,
      designValueRefs: [],
    } as never);
    expect(() => uiSpecDraftSchema.parse(invalid)).toThrow(
      "icon 必须提供 assetRef 或 symbol",
    );
  });

  it("拒绝 P1 组件必填约束和重复 value", () => {
    const draft = createUISpecDraft();
    draft.state.push({ key: "activeTab", valueType: "string", initialValue: "a" });

    const noAvatar = structuredClone(draft);
    noAvatar.nodes.push({
      id: "avatar",
      kind: "avatar",
      alt: "头像",
      designValueRefs: [],
    } as unknown as (typeof noAvatar.nodes)[number]);
    expect(() => uiSpecDraftSchema.parse(noAvatar)).toThrow(
      "avatar 必须提供 assetRef 或 initials",
    );

    const noSpacer = structuredClone(draft);
    noSpacer.nodes.push({
      id: "spacer",
      kind: "spacer",
      designValueRefs: [],
    } as unknown as (typeof noSpacer.nodes)[number]);
    expect(() => uiSpecDraftSchema.parse(noSpacer)).toThrow(
      "spacer 必须提供 width 或 height",
    );

    const duplicateTab = structuredClone(draft);
    duplicateTab.nodes.push({
      id: "tabs",
      kind: "tabs",
      stateKey: "activeTab",
      tabs: [
        { value: "a", label: "A", childIds: [] },
        { value: "a", label: "B", childIds: [] },
      ],
      designValueRefs: [],
    } as unknown as (typeof duplicateTab.nodes)[number]);
    expect(() => uiSpecDraftSchema.parse(duplicateTab)).toThrow("重复标识");
  });

  it("拒绝 P1 交互组件状态类型不匹配", () => {
    const draft = createUISpecDraft();
    draft.state.push({ key: "notify", valueType: "string", initialValue: "no" });
    draft.nodes.push({
      id: "notify-switch",
      kind: "switch",
      label: "通知",
      stateKey: "notify",
      designValueRefs: [],
    });
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("notify-switch");
    }

    expect(() => uiSpecDraftSchema.parse(draft)).toThrow(
      "复选框、开关和对话框必须引用布尔状态",
    );
  });
});
