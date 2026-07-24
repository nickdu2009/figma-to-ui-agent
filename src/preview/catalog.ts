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
    fontSize: z.number().positive().max(512).optional(),
    fontWeight: z
      .enum(["regular", "medium", "semibold", "bold"])
      .optional(),
    lineHeight: z.number().positive().max(10).optional(),
    borderRadius: z.number().nonnegative().max(10_000).optional(),
    borderColor: color.optional(),
    borderWidth: z.number().nonnegative().max(1_000).optional(),
    boxShadow: z.enum(["none", "sm", "md", "lg"]).optional(),
    width: z.number().positive().max(100_000).optional(),
    height: z.number().positive().max(100_000).optional(),
    minWidth: z.number().positive().max(100_000).optional(),
    minHeight: z.number().positive().max(100_000).optional(),
    maxWidth: z.number().positive().max(100_000).optional(),
    maxHeight: z.number().positive().max(100_000).optional(),
  })
  .strict();

const common = {
  nodeId,
  designValueRefs,
  style: controlledStyle.optional(),
};

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
