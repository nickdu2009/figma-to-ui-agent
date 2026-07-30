import { z } from "zod";

import { projectIdSchema } from "../project-store/project-id.ts";
import {
  safeRelativePathSchema,
  SCHEMA_VERSION,
} from "../project-store/schemas.ts";

const idSchema = z.string().min(1).max(256);
const idListSchema = z.array(idSchema).max(10_000);
const scalarSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
]);
const visibleWhenSchema = z
  .object({
    stateKey: idSchema,
    equals: scalarSchema,
  })
  .strict();

const routePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      /^\/(?:[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*)?$/.test(
        value,
      ),
    "路由必须是由小写字母、数字、连字符和下划线组成的站内绝对路径",
  );

export const uiImagePathSchema = safeRelativePathSchema.refine(
  (value) =>
    /^figma\/(?:assets|screenshots)\/[a-f0-9]{64}\.(?:png|jpe?g|webp)$/.test(
      value,
    ),
  "图片必须引用项目内已登记的 Figma 图片",
);

const overlayFrameSchema = z
  .object({
    x: z.number().finite().nonnegative().max(100_000),
    y: z.number().finite().nonnegative().max(100_000),
    width: z.number().finite().positive().max(100_000),
    height: z.number().finite().positive().max(100_000),
  })
  .strict();

const uiColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/);
const uiBackgroundImageSchema = z
  .string()
  .regex(
    /^linear-gradient\(180deg, #[0-9a-fA-F]{6} 0%, #[0-9a-fA-F]{6} 100%\)$/,
  );
const uiIconSymbolSchema = z.enum([
  "chevron-down",
  "info",
  "plus",
  "users",
  "cursor-arrow",
  "battery",
  "edit",
  "generic",
]);

export const uiFontWeightSchema = z.union([
  z.enum(["regular", "medium", "semibold", "bold"]),
  z.number().int().min(1).max(1_000),
]);

const uiStyleSchema = z
  .object({
    backgroundColor: uiColorSchema.optional(),
    backgroundImage: uiBackgroundImageSchema.optional(),
    textColor: uiColorSchema.optional(),
    fontFamily: z.string().min(1).max(256).optional(),
    fontSize: z.number().finite().positive().max(512).optional(),
    fontWeight: uiFontWeightSchema.optional(),
    lineHeight: z.number().finite().positive().max(10).optional(),
    letterSpacing: z.number().finite().min(-1_000).max(1_000).optional(),
    textAlign: z
      .enum(["left", "center", "right", "justify"])
      .optional(),
    whiteSpace: z
      .enum(["normal", "nowrap", "pre-line", "pre-wrap"])
      .optional(),
    borderRadius: z.number().finite().nonnegative().max(10_000).optional(),
    borderColor: uiColorSchema.optional(),
    borderWidth: z.number().finite().nonnegative().max(1_000).optional(),
    boxShadow: z.enum(["none", "sm", "md", "lg"]).optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    objectPosition: z.string().min(1).max(128).optional(),
    overflow: z.enum(["visible", "hidden", "auto"]).optional(),
    pointerEvents: z.enum(["auto", "none"]).optional(),
    width: z.number().finite().positive().max(100_000).optional(),
    height: z.number().finite().positive().max(100_000).optional(),
    minWidth: z.number().finite().positive().max(100_000).optional(),
    minHeight: z.number().finite().positive().max(100_000).optional(),
    maxWidth: z.number().finite().positive().max(100_000).optional(),
    maxHeight: z.number().finite().positive().max(100_000).optional(),
    position: z.enum(["relative", "absolute"]).optional(),
    left: z.number().finite().min(-100_000).max(100_000).optional(),
    top: z.number().finite().min(-100_000).max(100_000).optional(),
    zIndex: z.number().int().min(-1_000).max(1_000).optional(),
  })
  .strict();

const nodeBaseShape = {
  id: idSchema,
  designValueRefs: idListSchema,
  visibleWhen: visibleWhenSchema.optional(),
  style: uiStyleSchema.optional(),
  sourceComponent: z
    .object({
      componentRef: idSchema.optional(),
      family: z
        .enum([
          "button",
          "input",
          "select",
          "checkbox",
          "radio",
          "switch",
          "modal",
          "tag",
          "avatar",
          "icon",
          "unknown",
        ])
        .optional(),
      state: z
        .enum(["default", "hover", "disabled", "error", "selected"])
        .optional(),
      variantProperties: z
        .record(z.string().min(1).max(256), scalarSchema)
        .optional(),
    })
    .strict()
    .optional(),
};

export const uiNodeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("stack"),
      direction: z.enum(["horizontal", "vertical"]),
      childIds: idListSchema,
      actionId: idSchema.optional(),
      gap: z.number().finite().nonnegative().max(10_000).optional(),
      padding: z.number().finite().nonnegative().max(10_000).optional(),
      align: z.enum(["start", "center", "end", "stretch"]).optional(),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("grid"),
      columns: z.number().int().min(1).max(24),
      childIds: idListSchema,
      gap: z.number().finite().nonnegative().max(10_000).optional(),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("section"),
      semantic: z.enum(["header", "main", "section", "footer", "aside"]),
      childIds: idListSchema,
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("dialog"),
      title: z.string().min(1).max(512),
      openStateKey: idSchema,
      childIds: idListSchema,
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("text"),
      text: z.string().max(100_000),
      variant: z.enum(["heading", "body", "label", "caption"]),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("image"),
      assetRef: uiImagePathSchema,
      alt: z.string().min(1).max(1_000),
      fit: z.enum(["contain", "cover", "fill"]),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("pixel_overlay"),
      assetRef: uiImagePathSchema,
      alt: z.string().min(1).max(1_000),
      width: z.number().finite().positive().max(100_000),
      height: z.number().finite().positive().max(100_000),
      frame: overlayFrameSchema.optional(),
      childIds: idListSchema,
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("button"),
      label: z.string().min(1).max(512),
      actionId: idSchema.optional(),
      variant: z.enum(["primary", "secondary", "ghost", "danger"]),
      disabled: z.boolean().optional(),
      frame: overlayFrameSchema.optional(),
      leadingIconAssetRef: uiImagePathSchema.optional(),
      trailingIconAssetRef: uiImagePathSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("input"),
      label: z.string().min(1).max(512),
      stateKey: idSchema,
      inputType: z.enum(["text", "email", "password", "search"]),
      placeholder: z.string().max(1_000).optional(),
      disabled: z.boolean().optional(),
      frame: overlayFrameSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("checkbox"),
      label: z.string().min(1).max(512),
      stateKey: idSchema,
      actionId: idSchema.optional(),
      disabled: z.boolean().optional(),
      frame: overlayFrameSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("link"),
      label: z.string().min(1).max(512),
      actionId: idSchema.optional(),
      disabled: z.boolean().optional(),
      frame: overlayFrameSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("radio"),
      label: z.string().min(1).max(512),
      stateKey: idSchema,
      value: z.string().min(1).max(1_000),
      actionId: idSchema.optional(),
      disabled: z.boolean().optional(),
      frame: overlayFrameSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("switch"),
      label: z.string().min(1).max(512),
      stateKey: idSchema,
      actionId: idSchema.optional(),
      disabled: z.boolean().optional(),
      frame: overlayFrameSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("select"),
      label: z.string().min(1).max(512),
      stateKey: idSchema,
      options: z
        .array(
          z
            .object({
              value: z.string().min(1).max(1_000),
              label: z.string().min(1).max(1_000),
            })
            .strict(),
        )
        .min(1)
        .max(1_000),
      placeholder: z.string().max(1_000).optional(),
      disabled: z.boolean().optional(),
      frame: overlayFrameSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("textarea"),
      label: z.string().min(1).max(512),
      stateKey: idSchema,
      placeholder: z.string().max(1_000).optional(),
      disabled: z.boolean().optional(),
      frame: overlayFrameSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("form_field"),
      label: z.string().min(1).max(512),
      helpText: z.string().max(2_000).optional(),
      errorText: z.string().max(2_000).optional(),
      required: z.boolean().optional(),
      childIds: idListSchema,
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("icon"),
      assetRef: uiImagePathSchema.optional(),
      symbol: uiIconSymbolSchema.optional(),
      alt: z.string().min(1).max(1_000).optional(),
      decorative: z.boolean().optional(),
    })
    .strict()
    .refine((node) => node.assetRef !== undefined || node.symbol !== undefined, {
      message: "icon 必须提供 assetRef 或 symbol",
    }),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("spacer"),
      width: z.number().finite().positive().max(100_000).optional(),
      height: z.number().finite().positive().max(100_000).optional(),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("card"),
      childIds: idListSchema,
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("list"),
      ordered: z.boolean().optional(),
      childIds: idListSchema,
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("list_item"),
      childIds: idListSchema,
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("badge"),
      label: z.string().min(1).max(512),
      tone: z
        .enum(["neutral", "success", "warning", "danger", "info"])
        .optional(),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("avatar"),
      assetRef: uiImagePathSchema.optional(),
      initials: z.string().max(8).optional(),
      alt: z.string().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("tabs"),
      stateKey: idSchema,
      tabs: z
        .array(
          z
            .object({
              value: z.string().min(1).max(1_000),
              label: z.string().min(1).max(1_000),
              childIds: idListSchema,
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("nav"),
      orientation: z.enum(["horizontal", "vertical"]),
      childIds: idListSchema,
    })
    .strict(),
  z
    .object({
      ...nodeBaseShape,
      kind: z.literal("divider"),
    })
    .strict(),
]);

const uiPageSchema = z
  .object({
    id: idSchema,
    sourcePageId: idSchema,
    path: routePathSchema,
    title: z.string().min(1).max(512),
    rootNodeId: idSchema,
  })
  .strict();

const stateEntrySchema = z.discriminatedUnion("valueType", [
  z
    .object({
      key: idSchema,
      valueType: z.literal("string"),
      initialValue: z.string().max(10_000),
    })
    .strict(),
  z
    .object({
      key: idSchema,
      valueType: z.literal("number"),
      initialValue: z.number().finite(),
    })
    .strict(),
  z
    .object({
      key: idSchema,
      valueType: z.literal("boolean"),
      initialValue: z.boolean(),
    })
    .strict(),
]);

const uiActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: idSchema,
      kind: z.literal("navigate"),
      pageId: idSchema,
    })
    .strict(),
  z
    .object({
      id: idSchema,
      kind: z.literal("set_state"),
      stateKey: idSchema,
      value: scalarSchema,
    })
    .strict(),
  z
    .object({
      id: idSchema,
      kind: z.literal("open_dialog"),
      dialogNodeId: idSchema,
    })
    .strict(),
]);

const viewportSchema = z
  .object({
    id: idSchema,
    width: z.number().int().min(240).max(10_000),
    height: z.number().int().min(240).max(10_000),
    deviceScaleFactor: z.number().positive().max(8),
  })
  .strict();

export const behaviorStepSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("click"),
      nodeId: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("fill"),
      nodeId: idSchema,
      value: z.string().max(10_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("toggle"),
      nodeId: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("expect_visible"),
      nodeId: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("expect_text"),
      nodeId: idSchema,
      text: z.string().max(100_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("expect_value"),
      nodeId: idSchema,
      value: z.string().max(10_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("expect_checked"),
      nodeId: idSchema,
      checked: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("expect_page"),
      pageId: idSchema,
    })
    .strict(),
]);

export const behaviorFixtureSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(512),
    viewportId: idSchema,
    initialPageId: idSchema,
    steps: z.array(behaviorStepSchema).min(1).max(1_000),
  })
  .strict();

const uiSpecShape = {
  schemaVersion: z.literal(SCHEMA_VERSION),
  catalogVersion: z.literal("1"),
  projectId: projectIdSchema,
  revision: z.number().int().positive(),
  sourceDesignBundleRevision: z.number().int().positive(),
  sourceFlowPlanRevision: z.number().int().positive().optional(),
  designValueRefs: idListSchema,
  pages: z.array(uiPageSchema).min(1).max(1_000),
  nodes: z.array(uiNodeSchema).min(1).max(100_000),
  state: z.array(stateEntrySchema).max(10_000),
  actions: z.array(uiActionSchema).max(10_000),
  viewports: z.array(viewportSchema).min(1).max(100),
  behaviorFixtures: z.array(behaviorFixtureSchema).max(10_000),
};

function addDuplicateIssues(
  values: readonly string[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, index],
        message: `重复标识：${value}`,
      });
    }
    seen.add(value);
  });
}

function scalarMatchesState(
  valueType: "string" | "number" | "boolean",
  value: string | number | boolean,
): boolean {
  return typeof value === valueType;
}

type UISpecReferenceValue = Omit<
  z.infer<z.ZodObject<typeof uiSpecShape>>,
  "revision"
>;

function validateUISpecReferences(
  value: UISpecReferenceValue,
  ctx: z.RefinementCtx,
): void {
  addDuplicateIssues(
    value.designValueRefs,
    ["designValueRefs"],
    ctx,
  );
  addDuplicateIssues(
    value.pages.map((page) => page.id),
    ["pages"],
    ctx,
  );
  addDuplicateIssues(
    value.pages.map((page) => page.path),
    ["pages"],
    ctx,
  );
  addDuplicateIssues(
    value.pages.map((page) => page.sourcePageId),
    ["pages"],
    ctx,
  );
  addDuplicateIssues(
    value.nodes.map((node) => node.id),
    ["nodes"],
    ctx,
  );
  addDuplicateIssues(
    value.state.map((entry) => entry.key),
    ["state"],
    ctx,
  );
  addDuplicateIssues(
    value.actions.map((action) => action.id),
    ["actions"],
    ctx,
  );
  addDuplicateIssues(
    value.viewports.map((viewport) => viewport.id),
    ["viewports"],
    ctx,
  );
  addDuplicateIssues(
    value.behaviorFixtures.map((fixture) => fixture.id),
    ["behaviorFixtures"],
    ctx,
  );

  const nodeById = new Map(value.nodes.map((node) => [node.id, node]));
  const pageIds = new Set(value.pages.map((page) => page.id));
  const actionIds = new Set(value.actions.map((action) => action.id));
  const designValueIds = new Set(value.designValueRefs);
  const stateByKey = new Map(
    value.state.map((entry) => [entry.key, entry]),
  );
  const viewportIds = new Set(
    value.viewports.map((viewport) => viewport.id),
  );
  const parentByChild = new Map<string, string>();
  const rootIds = new Set(value.pages.map((page) => page.rootNodeId));

  value.nodes.forEach((node, nodeIndex) => {
    node.designValueRefs.forEach((designValueId, refIndex) => {
      if (!designValueIds.has(designValueId)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", nodeIndex, "designValueRefs", refIndex],
          message: `节点引用了未声明的设计值：${designValueId}`,
        });
      }
    });

    if (node.visibleWhen) {
      const stateEntry = stateByKey.get(node.visibleWhen.stateKey);
      if (
        !stateEntry ||
        !scalarMatchesState(stateEntry.valueType, node.visibleWhen.equals)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", nodeIndex, "visibleWhen", "stateKey"],
          message: "条件可见性引用不存在或值类型不匹配",
        });
      }
    }

    const directChildIds = "childIds" in node ? node.childIds : [];
    const tabChildIds =
      node.kind === "tabs"
        ? node.tabs.flatMap((tab) => tab.childIds)
        : [];
    const allChildIds = [...directChildIds, ...tabChildIds];
    if (allChildIds.length > 0) {
      addDuplicateIssues(
        allChildIds,
        ["nodes", nodeIndex, "childIds"],
        ctx,
      );
      allChildIds.forEach((childId, childIndex) => {
        if (!nodeById.has(childId)) {
          ctx.addIssue({
            code: "custom",
            path: ["nodes", nodeIndex, "childIds", childIndex],
            message: `悬空子节点引用：${childId}`,
          });
          return;
        }
        const existingParent = parentByChild.get(childId);
        if (existingParent && existingParent !== node.id) {
          ctx.addIssue({
            code: "custom",
            path: ["nodes", nodeIndex, "childIds", childIndex],
            message: `节点不能有多个父节点：${childId}`,
          });
        }
        parentByChild.set(childId, node.id);
      });
    }

    const nodeActionId = "actionId" in node ? node.actionId : undefined;
    if (nodeActionId && !actionIds.has(nodeActionId)) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes", nodeIndex, "actionId"],
        message: `悬空动作引用：${nodeActionId}`,
      });
    }

    if (
      node.kind === "input" ||
      node.kind === "radio" ||
      node.kind === "select" ||
      node.kind === "textarea" ||
      node.kind === "tabs"
    ) {
      const stateEntry = stateByKey.get(node.stateKey);
      if (!stateEntry || stateEntry.valueType !== "string") {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", nodeIndex, "stateKey"],
          message: `${node.kind} 必须引用字符串状态`,
        });
      }
    }
    if (node.kind === "checkbox" || node.kind === "switch" || node.kind === "dialog") {
      const stateKey =
        node.kind === "dialog" ? node.openStateKey : node.stateKey;
      if (stateByKey.get(stateKey)?.valueType === "boolean") {
        return;
      }
      ctx.addIssue({
        code: "custom",
        path: [
          "nodes",
          nodeIndex,
          node.kind === "dialog" ? "openStateKey" : "stateKey",
        ],
        message: "复选框、开关和对话框必须引用布尔状态",
      });
    }

    if (node.kind === "select") {
      addDuplicateIssues(
        node.options.map((option) => option.value),
        ["nodes", nodeIndex, "options"],
        ctx,
      );
    }
    if (node.kind === "tabs") {
      addDuplicateIssues(
        node.tabs.map((tab) => tab.value),
        ["nodes", nodeIndex, "tabs"],
        ctx,
      );
    }
    if (node.kind === "avatar") {
      if (!node.assetRef && !node.initials) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", nodeIndex],
          message: "avatar 必须提供 assetRef 或 initials",
        });
      }
    }
    if (node.kind === "spacer") {
      if (node.width === undefined && node.height === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", nodeIndex],
          message: "spacer 必须提供 width 或 height",
        });
      }
    }
  });

  value.pages.forEach((page, pageIndex) => {
    if (!nodeById.has(page.rootNodeId)) {
      ctx.addIssue({
        code: "custom",
        path: ["pages", pageIndex, "rootNodeId"],
        message: `悬空页面根节点引用：${page.rootNodeId}`,
      });
    }
    if (parentByChild.has(page.rootNodeId)) {
      ctx.addIssue({
        code: "custom",
        path: ["pages", pageIndex, "rootNodeId"],
        message: `页面根节点不能同时作为子节点：${page.rootNodeId}`,
      });
    }
  });

  const reachedFromPage = new Map<string, string>();
  const visit = (
    nodeId: string,
    pageId: string,
    activePath: Set<string>,
  ): void => {
    const node = nodeById.get(nodeId);
    if (!node) {
      return;
    }
    if (activePath.has(nodeId)) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message: `节点图存在循环：${nodeId}`,
      });
      return;
    }
    const previousPage = reachedFromPage.get(nodeId);
    if (previousPage) {
      if (previousPage !== pageId) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes"],
          message: `节点不能被多个页面共享：${nodeId}`,
        });
      }
      return;
    }
    reachedFromPage.set(nodeId, pageId);
    const directChildIds = "childIds" in node ? node.childIds : [];
    const tabChildIds =
      node.kind === "tabs"
        ? node.tabs.flatMap((tab) => tab.childIds)
        : [];
    const allChildIds = [...directChildIds, ...tabChildIds];
    if (allChildIds.length === 0) {
      return;
    }
    const nextPath = new Set(activePath);
    nextPath.add(nodeId);
    allChildIds.forEach((childId) => visit(childId, pageId, nextPath));
  };

  value.pages.forEach((page) => {
    visit(page.rootNodeId, page.id, new Set<string>());
  });
  value.nodes.forEach((node, index) => {
    if (!reachedFromPage.has(node.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes", index],
        message: `节点必须从且只能从一个页面根节点可达：${node.id}`,
      });
    }
  });

  value.actions.forEach((action, actionIndex) => {
    if (action.kind === "navigate" && !pageIds.has(action.pageId)) {
      ctx.addIssue({
        code: "custom",
        path: ["actions", actionIndex, "pageId"],
        message: `悬空页面引用：${action.pageId}`,
      });
    }
    if (action.kind === "set_state") {
      const stateEntry = stateByKey.get(action.stateKey);
      if (
        !stateEntry ||
        !scalarMatchesState(stateEntry.valueType, action.value)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["actions", actionIndex, "stateKey"],
          message: "状态动作引用不存在或值类型不匹配",
        });
      }
    }
    if (action.kind === "open_dialog") {
      const target = nodeById.get(action.dialogNodeId);
      if (!target || target.kind !== "dialog") {
        ctx.addIssue({
          code: "custom",
          path: ["actions", actionIndex, "dialogNodeId"],
          message: "打开对话框动作必须引用 dialog 节点",
        });
      }
    }
  });

  value.behaviorFixtures.forEach((fixture, fixtureIndex) => {
    if (!viewportIds.has(fixture.viewportId)) {
      ctx.addIssue({
        code: "custom",
        path: ["behaviorFixtures", fixtureIndex, "viewportId"],
        message: `悬空视口引用：${fixture.viewportId}`,
      });
    }
    if (!pageIds.has(fixture.initialPageId)) {
      ctx.addIssue({
        code: "custom",
        path: ["behaviorFixtures", fixtureIndex, "initialPageId"],
        message: `悬空初始页面引用：${fixture.initialPageId}`,
      });
    }
    fixture.steps.forEach((step, stepIndex) => {
      if ("nodeId" in step) {
        const target = nodeById.get(step.nodeId);
        if (!target) {
          ctx.addIssue({
            code: "custom",
            path: [
              "behaviorFixtures",
              fixtureIndex,
              "steps",
              stepIndex,
              "nodeId",
            ],
            message: `悬空行为节点引用：${step.nodeId}`,
          });
        } else {
          const validTarget =
            step.kind === "fill"
              ? target.kind === "input" || target.kind === "textarea"
              : step.kind === "toggle"
                ? target.kind === "checkbox" || target.kind === "switch"
                : step.kind === "expect_value"
                  ? target.kind === "input" || target.kind === "textarea"
                  : step.kind === "expect_checked"
                    ? target.kind === "checkbox" ||
                      target.kind === "switch" ||
                      target.kind === "radio"
                : step.kind === "click"
                  ? target.kind === "button" ||
                    target.kind === "link" ||
                    target.kind === "checkbox" ||
                    target.kind === "radio" ||
                    target.kind === "switch" ||
                    target.kind === "select" ||
                    (target.kind === "stack" && Boolean(target.actionId))
                  : step.kind === "expect_text"
                    ? target.kind === "text" ||
                      target.kind === "button" ||
                      target.kind === "badge" ||
                      target.kind === "link"
                    : true;
          if (!validTarget) {
            ctx.addIssue({
              code: "custom",
              path: [
                "behaviorFixtures",
                fixtureIndex,
                "steps",
                stepIndex,
                "nodeId",
              ],
              message: `行为 ${step.kind} 与目标组件 ${target.kind} 不兼容`,
            });
          }
        }
      }
      if ("pageId" in step && !pageIds.has(step.pageId)) {
        ctx.addIssue({
          code: "custom",
          path: [
            "behaviorFixtures",
            fixtureIndex,
            "steps",
            stepIndex,
            "pageId",
          ],
          message: `悬空行为页面引用：${step.pageId}`,
        });
      }
    });
  });
}

const uiSpecObjectSchema = z.object(uiSpecShape).strict();
const uiSpecDraftObjectSchema = uiSpecObjectSchema.omit({
  revision: true,
});

export const uiSpecSchema =
  uiSpecObjectSchema.superRefine(validateUISpecReferences);

export const uiSpecDraftSchema =
  uiSpecDraftObjectSchema.superRefine(validateUISpecReferences);

export type UINode = z.infer<typeof uiNodeSchema>;
export type UISpec = z.infer<typeof uiSpecSchema>;
export type UISpecDraft = z.infer<typeof uiSpecDraftSchema>;
