import type { ZodType } from "zod";

import { previewCatalog } from "../../src/preview/catalog.ts";
import type { UINode, UISpec } from "../../src/ui-spec/schema.ts";
import type { ComponentFixture, PropControl } from "./fixture-types.ts";

export const PLACEHOLDER_ASSET_REF =
  "figma/assets/0000000000000000000000000000000000000000000000000000000000000000.png";

interface FixtureParts {
  node: UINode;
  state: UISpec["state"];
  actions: UISpec["actions"];
  controllableProps: PropControl[];
  extraNodes?: UINode[];
  extraChildIds?: string[];
}

interface ComponentBuilder {
  title: string;
  description: string;
  category: import("./fixture-types.ts").ComponentCategory;
  build: () => FixtureParts;
}

function unwrapZodType(schema: ZodType): ZodType {
  const maybeWrapped = schema as unknown as {
    type: string;
    unwrap?: () => ZodType;
  };
  if (
    (maybeWrapped.type === "nullable" || maybeWrapped.type === "optional") &&
    maybeWrapped.unwrap
  ) {
    return maybeWrapped.unwrap();
  }
  return schema;
}

function deriveEnumOptions(schema: ZodType): string[] | undefined {
  const unwrapped = unwrapZodType(schema);
  const maybeEnum = unwrapped as unknown as {
    type: string;
    options?: string[];
  };
  if (maybeEnum.type === "enum" && Array.isArray(maybeEnum.options)) {
    return maybeEnum.options.slice();
  }
  return undefined;
}

function enrichControls(
  kind: string,
  controls: PropControl[],
): PropControl[] {
  const catalog = previewCatalog as unknown as {
    data: {
      components: Record<
        string,
        { props?: { shape?: Record<string, ZodType> } }
      >;
    };
  };
  const propsSchema = catalog.data.components[kind]?.props;
  const shape = propsSchema?.shape;
  if (!shape) {
    return controls;
  }
  return controls.map((control) => {
    const propSchema = shape[control.name];
    if (!propSchema) {
      return control;
    }
    const typed = unwrapZodType(propSchema) as unknown as {
      type: string;
      minLength?: number;
      maxLength?: number;
      minValue?: number;
      maxValue?: number;
      isInt?: boolean;
    };
    const extras: Partial<PropControl> = {};
    if (typed.type === "string") {
      if (typeof typed.minLength === "number") {
        extras.minLength = typed.minLength;
      }
      if (typeof typed.maxLength === "number") {
        extras.maxLength = typed.maxLength;
      }
    } else if (typed.type === "number") {
      if (typeof typed.minValue === "number") {
        extras.min = typed.minValue;
      }
      if (typeof typed.maxValue === "number") {
        extras.max = typed.maxValue;
      }
      if (typed.isInt) {
        extras.isInt = true;
      }
    }
    return { ...control, ...extras };
  });
}

function enumControl(
  name: string,
  options: string[],
  defaultValue: string,
): PropControl {
  return { name, type: "enum", options, defaultValue };
}

function booleanControl(
  name: string,
  defaultValue: boolean,
): PropControl {
  return { name, type: "boolean", defaultValue };
}

function stringControl(
  name: string,
  defaultValue: string,
): PropControl {
  return { name, type: "string", defaultValue };
}

function numberControl(
  name: string,
  defaultValue: number,
  constraints?: { min?: number; max?: number; isInt?: boolean },
): PropControl {
  return { name, type: "number", defaultValue, ...constraints };
}

const baseNode = {
  designValueRefs: [],
};

const builders: Record<string, ComponentBuilder> = {
  Stack: {
    title: "Stack",
    description: "水平或垂直布局容器",
    category: "layout",
    build: () => ({
      node: {
        ...baseNode,
        id: "stack",
        kind: "stack",
        direction: "vertical",
        gap: 8,
        padding: 16,
        childIds: ["stack-text-1", "stack-text-2"],
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [
        enumControl("direction", ["horizontal", "vertical"], "vertical"),
        numberControl("gap", 8),
        numberControl("padding", 16),
        enumControl("align", ["start", "center", "end", "stretch"], "stretch"),
      ],
    }),
  },

  Grid: {
    title: "Grid",
    description: "网格布局容器",
    category: "layout",
    build: () => ({
      node: {
        ...baseNode,
        id: "grid",
        kind: "grid",
        columns: 2,
        gap: 8,
        childIds: ["grid-text-1", "grid-text-2"],
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [
        numberControl("columns", 2),
        numberControl("gap", 8),
      ],
    }),
  },

  Section: {
    title: "Section",
    description: "带语义标签的页面区域",
    category: "layout",
    build: () => ({
      node: {
        ...baseNode,
        id: "section",
        kind: "section",
        semantic: "section",
        childIds: ["section-text"],
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [
        enumControl("semantic", ["header", "main", "section", "footer", "aside"], "section"),
      ],
    }),
  },

  Dialog: {
    title: "Dialog",
    description: "由布尔状态控制可见性的对话框",
    category: "overlay",
    build: () => ({
      node: {
        ...baseNode,
        id: "dialog",
        kind: "dialog",
        title: "示例对话框",
        openStateKey: "dialogOpen",
        childIds: ["dialog-text"],
      } as UINode,
      state: [
        {
          key: "dialogOpen",
          valueType: "boolean",
          initialValue: true,
        },
      ],
      actions: [],
      controllableProps: [stringControl("title", "示例对话框")],
    }),
  },

  Text: {
    title: "Text",
    description: "受控文本节点",
    category: "content",
    build: () => ({
      node: {
        ...baseNode,
        id: "text",
        kind: "text",
        text: "这是一段示例文本",
        variant: "body",
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [
        stringControl("text", "这是一段示例文本"),
        enumControl("variant", ["heading", "body", "label", "caption"], "body"),
      ],
    }),
  },

  Image: {
    title: "Image",
    description: "项目内 Figma 图片",
    category: "content",
    build: () => ({
      node: {
        ...baseNode,
        id: "image",
        kind: "image",
        assetRef: PLACEHOLDER_ASSET_REF,
        alt: "示例图片",
        fit: "contain",
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [
        stringControl("alt", "示例图片"),
        enumControl("fit", ["contain", "cover", "fill"], "contain"),
      ],
    }),
  },

  PixelOverlay: {
    title: "PixelOverlay",
    description: "受控局部像素覆盖层",
    category: "overlay",
    build: () => ({
      node: {
        ...baseNode,
        id: "pixel-overlay",
        kind: "pixel_overlay",
        assetRef: PLACEHOLDER_ASSET_REF,
        alt: "示例覆盖层",
        width: 120,
        height: 80,
        childIds: [],
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [
        stringControl("alt", "示例覆盖层"),
        numberControl("width", 120, { min: 1 }),
        numberControl("height", 80, { min: 1 }),
      ],
    }),
  },

  Button: {
    title: "Button",
    description: "受控按钮",
    category: "form",
    build: () => ({
      node: {
        ...baseNode,
        id: "button",
        kind: "button",
        label: "提交",
        variant: "primary",
        actionId: "demo-button-clicked",
      } as UINode,
      state: [
        {
          key: "buttonDialogOpen",
          valueType: "boolean",
          initialValue: false,
        },
      ],
      actions: [
        {
          id: "demo-button-clicked",
          kind: "open_dialog",
          dialogNodeId: "button-feedback-dialog",
        },
      ],
      controllableProps: [
        stringControl("label", "提交"),
        enumControl("variant", ["primary", "secondary", "ghost", "danger"], "primary"),
        booleanControl("disabled", false),
      ],
      extraNodes: [
        {
          ...baseNode,
          id: "button-feedback-dialog",
          kind: "dialog",
          title: "提示",
          openStateKey: "buttonDialogOpen",
          childIds: ["button-feedback-text"],
        } as UINode,
        {
          ...baseNode,
          id: "button-feedback-text",
          kind: "text",
          text: "按钮已被点击",
          variant: "body",
        } as UINode,
      ],
      extraChildIds: ["button-feedback-dialog"],
    }),
  },

  Input: {
    title: "Input",
    description: "绑定字符串状态的输入框",
    category: "form",
    build: () => ({
      node: {
        ...baseNode,
        id: "input",
        kind: "input",
        label: "邮箱",
        stateKey: "inputValue",
        inputType: "email",
        placeholder: "请输入邮箱",
      } as UINode,
      state: [
        {
          key: "inputValue",
          valueType: "string",
          initialValue: "",
        },
      ],
      actions: [],
      controllableProps: [
        stringControl("label", "邮箱"),
        stringControl("placeholder", "请输入邮箱"),
        enumControl("inputType", ["text", "email", "password", "search"], "email"),
        booleanControl("disabled", false),
      ],
    }),
  },

  Checkbox: {
    title: "Checkbox",
    description: "绑定布尔状态的复选框",
    category: "form",
    build: () => ({
      node: {
        ...baseNode,
        id: "checkbox",
        kind: "checkbox",
        label: "同意条款",
        stateKey: "checked",
      } as UINode,
      state: [
        {
          key: "checked",
          valueType: "boolean",
          initialValue: false,
        },
      ],
      actions: [],
      controllableProps: [
        stringControl("label", "同意条款"),
        booleanControl("disabled", false),
      ],
    }),
  },

  Link: {
    title: "Link",
    description: "导航链接",
    category: "form",
    build: () => ({
      node: {
        ...baseNode,
        id: "link",
        kind: "link",
        label: "去首页",
        actionId: "demo-link-clicked",
      } as UINode,
      state: [
        {
          key: "linkDialogOpen",
          valueType: "boolean",
          initialValue: false,
        },
      ],
      actions: [
        {
          id: "demo-link-clicked",
          kind: "open_dialog",
          dialogNodeId: "link-feedback-dialog",
        },
      ],
      controllableProps: [
        stringControl("label", "去首页"),
        booleanControl("disabled", false),
      ],
      extraNodes: [
        {
          ...baseNode,
          id: "link-feedback-dialog",
          kind: "dialog",
          title: "提示",
          openStateKey: "linkDialogOpen",
          childIds: ["link-feedback-text"],
        } as UINode,
        {
          ...baseNode,
          id: "link-feedback-text",
          kind: "text",
          text: "链接已被点击",
          variant: "body",
        } as UINode,
      ],
      extraChildIds: ["link-feedback-dialog"],
    }),
  },

  Radio: {
    title: "Radio",
    description: "单选按钮",
    category: "form",
    build: () => ({
      node: {
        ...baseNode,
        id: "radio",
        kind: "radio",
        label: "基础版",
        stateKey: "plan",
        value: "basic",
      } as UINode,
      state: [
        {
          key: "plan",
          valueType: "string",
          initialValue: "basic",
        },
      ],
      actions: [],
      controllableProps: [
        stringControl("label", "基础版"),
        stringControl("value", "basic"),
        booleanControl("disabled", false),
      ],
    }),
  },

  Switch: {
    title: "Switch",
    description: "绑定布尔状态的开关",
    category: "form",
    build: () => ({
      node: {
        ...baseNode,
        id: "switch",
        kind: "switch",
        label: "接收通知",
        stateKey: "enabled",
      } as UINode,
      state: [
        {
          key: "enabled",
          valueType: "boolean",
          initialValue: false,
        },
      ],
      actions: [],
      controllableProps: [
        stringControl("label", "接收通知"),
        booleanControl("disabled", false),
      ],
    }),
  },

  Select: {
    title: "Select",
    description: "绑定字符串状态的下拉选择",
    category: "form",
    build: () => ({
      node: {
        ...baseNode,
        id: "select",
        kind: "select",
        label: "国家",
        stateKey: "country",
        options: [
          { value: "cn", label: "中国" },
          { value: "us", label: "美国" },
        ],
        placeholder: "请选择国家",
      } as UINode,
      state: [
        {
          key: "country",
          valueType: "string",
          initialValue: "",
        },
      ],
      actions: [],
      controllableProps: [
        stringControl("label", "国家"),
        stringControl("placeholder", "请选择国家"),
        booleanControl("disabled", false),
      ],
    }),
  },

  Textarea: {
    title: "Textarea",
    description: "绑定字符串状态的多行文本框",
    category: "form",
    build: () => ({
      node: {
        ...baseNode,
        id: "textarea",
        kind: "textarea",
        label: "简介",
        stateKey: "bio",
        placeholder: "请简单介绍自己",
      } as UINode,
      state: [
        {
          key: "bio",
          valueType: "string",
          initialValue: "",
        },
      ],
      actions: [],
      controllableProps: [
        stringControl("label", "简介"),
        stringControl("placeholder", "请简单介绍自己"),
        booleanControl("disabled", false),
      ],
    }),
  },

  FormField: {
    title: "FormField",
    description: "表单字段语义容器",
    category: "form",
    build: () => ({
      node: {
        ...baseNode,
        id: "form-field",
        kind: "form_field",
        label: "用户名",
        required: true,
        childIds: ["form-field-input"],
      } as UINode,
      state: [
        {
          key: "formFieldValue",
          valueType: "string",
          initialValue: "",
        },
      ],
      actions: [],
      controllableProps: [
        stringControl("label", "用户名"),
        booleanControl("required", true),
      ],
    }),
  },

  Icon: {
    title: "Icon",
    description: "项目内图标图片",
    category: "content",
    build: () => ({
      node: {
        ...baseNode,
        id: "icon",
        kind: "icon",
        assetRef: PLACEHOLDER_ASSET_REF,
        alt: "示例图标",
        decorative: false,
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [
        stringControl("alt", "示例图标"),
        booleanControl("decorative", false),
      ],
    }),
  },

  Spacer: {
    title: "Spacer",
    description: "固定间距占位",
    category: "layout",
    build: () => ({
      node: {
        ...baseNode,
        id: "spacer",
        kind: "spacer",
        width: 24,
        height: 24,
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [
        numberControl("width", 24, { min: 1 }),
        numberControl("height", 24, { min: 1 }),
      ],
    }),
  },

  Card: {
    title: "Card",
    description: "卡片语义容器",
    category: "layout",
    build: () => ({
      node: {
        ...baseNode,
        id: "card",
        kind: "card",
        childIds: ["card-text"],
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [],
    }),
  },

  List: {
    title: "List",
    description: "有序或无序列表",
    category: "content",
    build: () => ({
      node: {
        ...baseNode,
        id: "list",
        kind: "list",
        ordered: false,
        childIds: ["list-item-1", "list-item-2"],
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [booleanControl("ordered", false)],
    }),
  },

  ListItem: {
    title: "ListItem",
    description: "列表项",
    category: "content",
    build: () => ({
      node: {
        ...baseNode,
        id: "list-item",
        kind: "list_item",
        childIds: ["list-item-text"],
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [],
    }),
  },

  Badge: {
    title: "Badge",
    description: "状态徽章",
    category: "content",
    build: () => ({
      node: {
        ...baseNode,
        id: "badge",
        kind: "badge",
        label: "新消息",
        tone: "info",
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [
        stringControl("label", "新消息"),
        enumControl("tone", ["neutral", "success", "warning", "danger", "info"], "info"),
      ],
    }),
  },

  Avatar: {
    title: "Avatar",
    description: "头像图片或缩写",
    category: "content",
    build: () => ({
      node: {
        ...baseNode,
        id: "avatar",
        kind: "avatar",
        initials: "AB",
        alt: "用户头像",
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [
        stringControl("initials", "AB"),
        stringControl("alt", "用户头像"),
      ],
    }),
  },

  Tabs: {
    title: "Tabs",
    description: "选项卡",
    category: "navigation",
    build: () => ({
      node: {
        ...baseNode,
        id: "tabs",
        kind: "tabs",
        stateKey: "activeTab",
        tabs: [
          {
            value: "general",
            label: "常规",
            childIds: ["tab-general"],
          },
          {
            value: "advanced",
            label: "高级",
            childIds: ["tab-advanced"],
          },
        ],
      } as UINode,
      state: [
        {
          key: "activeTab",
          valueType: "string",
          initialValue: "general",
        },
      ],
      actions: [],
      controllableProps: [],
    }),
  },

  Nav: {
    title: "Nav",
    description: "导航语义容器",
    category: "navigation",
    build: () => ({
      node: {
        ...baseNode,
        id: "nav",
        kind: "nav",
        orientation: "horizontal",
        childIds: ["nav-link-1", "nav-link-2"],
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [
        enumControl("orientation", ["horizontal", "vertical"], "horizontal"),
      ],
    }),
  },

  Divider: {
    title: "Divider",
    description: "分隔线",
    category: "layout",
    build: () => ({
      node: {
        ...baseNode,
        id: "divider",
        kind: "divider",
      } as UINode,
      state: [],
      actions: [],
      controllableProps: [],
    }),
  },
};

function buildChildText(id: string, text: string): UINode {
  return {
    ...baseNode,
    id,
    kind: "text",
    text,
    variant: "body",
  } as UINode;
}

function buildChildInput(
  id: string,
  label: string,
  stateKey: string,
): UINode {
  return {
    ...baseNode,
    id,
    kind: "input",
    label,
    stateKey,
    inputType: "text",
  } as UINode;
}

function buildChildLink(id: string, label: string): UINode {
  return {
    ...baseNode,
    id,
    kind: "link",
    label,
  } as UINode;
}

function collectChildNodes(
  componentNode: UINode,
  extraChildren: UINode[] = [],
): UINode[] {
  const result: UINode[] = [componentNode, ...extraChildren];

  if (componentNode.kind === "stack") {
    result.push(
      buildChildText("stack-text-1", "第一行"),
      buildChildText("stack-text-2", "第二行"),
    );
  }

  if (componentNode.kind === "grid") {
    result.push(
      buildChildText("grid-text-1", "格子 1"),
      buildChildText("grid-text-2", "格子 2"),
    );
  }

  if (componentNode.kind === "section") {
    result.push(buildChildText("section-text", "区域内容"));
  }

  if (componentNode.kind === "dialog") {
    result.push(buildChildText("dialog-text", "对话框内容"));
  }

  if (componentNode.kind === "card") {
    result.push(buildChildText("card-text", "卡片内容"));
  }

  if (componentNode.kind === "list") {
    result.push(
      {
        ...baseNode,
        id: "list-item-1",
        kind: "list_item",
        childIds: ["list-item-1-text"],
      } as UINode,
      {
        ...baseNode,
        id: "list-item-2",
        kind: "list_item",
        childIds: ["list-item-2-text"],
      } as UINode,
      buildChildText("list-item-1-text", "列表项 1"),
      buildChildText("list-item-2-text", "列表项 2"),
    );
  }

  if (componentNode.kind === "list_item") {
    result.push(buildChildText("list-item-text", "单个列表项"));
  }

  if (componentNode.kind === "tabs") {
    result.push(
      buildChildText("tab-general", "常规面板内容"),
      buildChildText("tab-advanced", "高级面板内容"),
    );
  }

  if (componentNode.kind === "nav") {
    result.push(
      buildChildLink("nav-link-1", "链接一"),
      buildChildLink("nav-link-2", "链接二"),
    );
  }

  if (componentNode.kind === "form_field") {
    result.push(buildChildInput("form-field-input", "用户名", "formFieldValue"));
  }

  return result;
}

function makeSpecForComponent(
  kind: string,
  builder: ComponentBuilder,
): ComponentFixture {
  const parts = builder.build();
  const pageId = `page-${kind.toLowerCase()}`;
  const rootId = `root-${kind.toLowerCase()}`;

  const rootNode: UINode = {
    ...baseNode,
    id: rootId,
    kind: "stack",
    direction: "vertical",
    padding: 16,
    childIds: [parts.node.id, ...(parts.extraChildIds ?? [])],
  } as UINode;

  const nodes = collectChildNodes(parts.node, parts.extraNodes ?? []);
  nodes.unshift(rootNode);

  const spec: UISpec = {
    schemaVersion: "1",
    catalogVersion: "1",
    projectId: "catalog-fixtures",
    revision: 1,
    sourceDesignBundleRevision: 1,
    designValueRefs: [],
    pages: [
      {
        id: pageId,
        sourcePageId: pageId,
        path: "/",
        title: builder.title,
        rootNodeId: rootId,
      },
    ],
    nodes,
    state: parts.state,
    actions: parts.actions,
    viewports: [
      {
        id: "desktop",
        width: 320,
        height: 240,
        deviceScaleFactor: 1,
      },
    ],
    behaviorFixtures: [],
  };

  return {
    kind,
    nodeKind: parts.node.kind,
    category: builder.category,
    title: builder.title,
    description: builder.description,
    initialSpec: spec,
    controllableProps: enrichControls(kind, parts.controllableProps),
  };
}

export function generateComponentFixtures(): ComponentFixture[] {
  const catalog = previewCatalog as unknown as {
    data: { components: Record<string, { description?: string }> };
  };
  const componentNames = Object.keys(catalog.data.components);

  return componentNames
    .filter((name) => name !== "TabPanel")
    .map((name) => {
      const builder = builders[name];
      if (!builder) {
        throw new Error(`缺少组件 ${name} 的 fixture builder`);
      }
      return makeSpecForComponent(name, builder);
    });
}
