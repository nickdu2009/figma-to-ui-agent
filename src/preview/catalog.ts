import { defineCatalog, type Spec } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const nodeId = z.string().min(1).max(256);
const designValueRefs = z.array(nodeId).max(10_000);
const stateBinding = z
  .object({ $bindState: z.string().min(1).max(512) })
  .strict();
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/);
const controlledStyle = z
  .object({
    backgroundColor: color.optional(),
    textColor: color.optional(),
    fontFamily: z.string().min(1).max(256).optional(),
    fontSize: z.number().positive().max(512).optional(),
    fontWeight: z
      .enum(["regular", "medium", "semibold", "bold"])
      .optional(),
    lineHeight: z.number().positive().max(10).optional(),
    letterSpacing: z.number().min(-1_000).max(1_000).optional(),
    textAlign: z
      .enum(["left", "center", "right", "justify"])
      .optional(),
    whiteSpace: z
      .enum(["normal", "nowrap", "pre-line", "pre-wrap"])
      .optional(),
    borderRadius: z.number().nonnegative().max(10_000).optional(),
    borderColor: color.optional(),
    borderWidth: z.number().nonnegative().max(1_000).optional(),
    boxShadow: z.enum(["none", "sm", "md", "lg"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
    objectPosition: z.string().min(1).max(128).optional(),
    pointerEvents: z.enum(["auto", "none"]).optional(),
    width: z.number().positive().max(100_000).optional(),
    height: z.number().positive().max(100_000).optional(),
    minWidth: z.number().positive().max(100_000).optional(),
    minHeight: z.number().positive().max(100_000).optional(),
    maxWidth: z.number().positive().max(100_000).optional(),
    maxHeight: z.number().positive().max(100_000).optional(),
    position: z.enum(["relative", "absolute"]).optional(),
    left: z.number().min(-100_000).max(100_000).optional(),
    top: z.number().min(-100_000).max(100_000).optional(),
    zIndex: z.number().int().min(-1_000).max(1_000).optional(),
  })
  .strict();

const common = {
  nodeId,
  designValueRefs,
  style: controlledStyle.optional(),
};

const optionSchema = z
  .object({
    value: z.string().min(1).max(1_000),
    label: z.string().min(1).max(1_000),
  })
  .strict();

const tabSchema = z
  .object({
    value: z.string().min(1).max(1_000),
    label: z.string().min(1).max(1_000),
    childIds: z.array(nodeId).max(10_000),
  })
  .strict();

export const previewCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z
        .object({
          ...common,
          direction: z.enum(["horizontal", "vertical"]),
          gap: z.number().nonnegative().max(10_000).nullable(),
          padding: z.number().nonnegative().max(10_000).nullable(),
          align: z
            .enum(["start", "center", "end", "stretch"])
            .nullable(),
        })
        .strict(),
      description: "受控水平或垂直布局容器",
    },
    Grid: {
      props: z
        .object({
          ...common,
          columns: z.number().int().min(1).max(24),
          gap: z.number().nonnegative().max(10_000).nullable(),
        })
        .strict(),
      description: "受控网格布局容器",
    },
    Section: {
      props: z
        .object({
          ...common,
          semantic: z.enum([
            "header",
            "main",
            "section",
            "footer",
            "aside",
          ]),
        })
        .strict(),
      description: "带固定语义标签的页面区域",
    },
    Dialog: {
      props: z
        .object({
          ...common,
          title: z.string().min(1).max(512),
        })
        .strict(),
      description: "由布尔状态控制可见性的对话框",
    },
    Text: {
      props: z
        .object({
          ...common,
          text: z.string().max(100_000),
          variant: z.enum(["heading", "body", "label", "caption"]),
          visualOverlay: z
            .object({
              src: z.string().min(1).max(2_048),
              sourceWidth: z.number().positive().max(100_000),
              sourceHeight: z.number().positive().max(100_000),
              frame: z
                .object({
                  x: z.number().nonnegative().max(100_000),
                  y: z.number().nonnegative().max(100_000),
                  width: z.number().positive().max(100_000),
                  height: z.number().positive().max(100_000),
                })
                .strict(),
            })
            .strict()
            .nullable()
            .optional(),
        })
        .strict(),
      description: "受控文本节点",
    },
    Image: {
      props: z
        .object({
          ...common,
          src: z.string().min(1).max(2_048),
          alt: z.string().min(1).max(1_000),
          fit: z.enum(["contain", "cover", "fill"]),
        })
        .strict(),
      description: "项目内 Figma 图片",
    },
    PixelOverlay: {
      props: z
        .object({
          ...common,
          src: z.string().min(1).max(2_048),
          alt: z.string().min(1).max(1_000),
          width: z.number().positive().max(100_000),
          height: z.number().positive().max(100_000),
          sourceWidth: z.number().positive().max(100_000).nullable(),
          sourceHeight: z.number().positive().max(100_000).nullable(),
          frame: z
            .object({
              x: z.number().nonnegative().max(100_000),
              y: z.number().nonnegative().max(100_000),
              width: z.number().positive().max(100_000),
              height: z.number().positive().max(100_000),
            })
            .strict()
            .nullable(),
        })
        .strict(),
      description: "受控局部像素覆盖层",
    },
    Button: {
      props: z
        .object({
          ...common,
          label: z.string().min(1).max(512),
          variant: z.enum([
            "primary",
            "secondary",
            "ghost",
            "danger",
          ]),
          disabled: z.boolean(),
          leadingIconSrc: z.string().min(1).max(2_048).nullable(),
          trailingIconSrc: z.string().min(1).max(2_048).nullable(),
        })
        .strict(),
      description: "受控按钮",
    },
    Input: {
      props: z
        .object({
          ...common,
          label: z.string().min(1).max(512),
          value: z.union([z.string(), stateBinding]),
          inputType: z.enum(["text", "email", "password", "search"]),
          placeholder: z.string().max(1_000).nullable(),
          disabled: z.boolean(),
          hideLabel: z.boolean().optional(),
        })
        .strict(),
      description: "绑定字符串状态的输入框",
    },
    Checkbox: {
      props: z
        .object({
          ...common,
          label: z.string().min(1).max(512),
          checked: z.union([z.boolean(), stateBinding]),
          disabled: z.boolean(),
        })
        .strict(),
      description: "绑定布尔状态的复选框",
    },
    Link: {
      props: z
        .object({
          ...common,
          label: z.string().min(1).max(512),
          disabled: z.boolean(),
        })
        .strict(),
      description: "导航链接，可绑定声明式动作",
    },
    Radio: {
      props: z
        .object({
          ...common,
          label: z.string().min(1).max(512),
          value: z.string().min(1).max(1_000),
          stateKey: nodeId,
          disabled: z.boolean(),
        })
        .strict(),
      description: "单选按钮，共享 stateKey 表达选项组",
    },
    Switch: {
      props: z
        .object({
          ...common,
          label: z.string().min(1).max(512),
          checked: z.union([z.boolean(), stateBinding]),
          disabled: z.boolean(),
        })
        .strict(),
      description: "绑定布尔状态的开关",
    },
    Select: {
      props: z
        .object({
          ...common,
          label: z.string().min(1).max(512),
          value: z.union([z.string(), stateBinding]),
          options: z.array(optionSchema).min(1).max(1_000),
          placeholder: z.string().max(1_000).nullable(),
          disabled: z.boolean(),
        })
        .strict(),
      description: "绑定字符串状态的下拉选择",
    },
    Textarea: {
      props: z
        .object({
          ...common,
          label: z.string().min(1).max(512),
          value: z.union([z.string(), stateBinding]),
          placeholder: z.string().max(1_000).nullable(),
          disabled: z.boolean(),
        })
        .strict(),
      description: "绑定字符串状态的多行文本框",
    },
    FormField: {
      props: z
        .object({
          ...common,
          label: z.string().min(1).max(512),
          helpText: z.string().max(2_000).nullable(),
          errorText: z.string().max(2_000).nullable(),
          required: z.boolean(),
        })
        .strict(),
      description: "表单字段语义容器",
    },
    Icon: {
      props: z
        .object({
          ...common,
          src: z.string().min(1).max(2_048),
          alt: z.string().min(1).max(1_000),
          decorative: z.boolean(),
        })
        .strict(),
      description: "项目内图标图片",
    },
    Spacer: {
      props: z
        .object({
          ...common,
          width: z.number().positive().max(100_000).nullable(),
          height: z.number().positive().max(100_000).nullable(),
        })
        .strict(),
      description: "固定间距占位",
    },
    Card: {
      props: z.object(common).strict(),
      description: "卡片语义容器",
    },
    List: {
      props: z
        .object({
          ...common,
          ordered: z.boolean(),
        })
        .strict(),
      description: "有序或无序列表",
    },
    ListItem: {
      props: z.object(common).strict(),
      description: "列表项",
    },
    Badge: {
      props: z
        .object({
          ...common,
          label: z.string().min(1).max(512),
          tone: z
            .enum(["neutral", "success", "warning", "danger", "info"])
            .nullable(),
        })
        .strict(),
      description: "状态徽章",
    },
    Avatar: {
      props: z
        .object({
          ...common,
          src: z.string().min(1).max(2_048).nullable(),
          initials: z.string().max(8).nullable(),
          alt: z.string().min(1).max(1_000),
        })
        .strict(),
      description: "头像图片或缩写",
    },
    Tabs: {
      props: z
        .object({
          ...common,
          selectedTab: z.union([z.string(), stateBinding]),
          tabs: z.array(tabSchema).min(1).max(100),
        })
        .strict(),
      description: "选项卡，子元素为 TabPanel",
    },
    TabPanel: {
      props: z
        .object({
          ...common,
          stateKey: nodeId,
          value: z.string().min(1).max(1_000),
        })
        .strict(),
      description: "选项卡面板，按 stateKey/value 显示",
    },
    Nav: {
      props: z
        .object({
          ...common,
          orientation: z.enum(["horizontal", "vertical"]),
        })
        .strict(),
      description: "导航语义容器",
    },
    Divider: {
      props: z.object(common).strict(),
      description: "分隔线",
    },
  },
  actions: {
    dispatch: {
      params: z
        .object({
          actionId: z.string().min(1).max(256),
        })
        .strict(),
      description: "执行 UISpec 中已声明的动作",
    },
  },
});

export type PreviewJsonSpec = Spec;
