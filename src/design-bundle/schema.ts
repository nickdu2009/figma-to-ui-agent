import { posix } from "node:path";

import { z } from "zod";

import { projectIdSchema } from "../project-store/project-id.ts";
import {
  isoTimestampSchema,
  safeRelativePathSchema,
  SCHEMA_VERSION,
  sha256Schema,
} from "../project-store/schemas.ts";

const idSchema = z.string().min(1).max(256);
const nameSchema = z.string().min(1).max(512);
const idListSchema = z.array(idSchema).max(10_000);

export const variablesCapabilitySchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("available"),
      variableCount: z.number().int().nonnegative(),
      collectionCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable_optional"),
      reasonCode: z.enum([
        "plan_limited",
        "account_type",
        "invalid_scope",
        "file_unsupported",
        "unauthorized",
        "unknown",
      ]),
    })
    .strict(),
]);

export const localImageRefSchema = z
  .object({
    path: safeRelativePathSchema.refine(
      (value) =>
        /^figma\/(?:assets|screenshots)\/[a-f0-9]{64}\.(?:png|jpe?g|webp)$/.test(
          value,
        ),
      "图片路径必须位于项目 figma 目录并使用内容哈希命名",
    ),
    sha256: sha256Schema,
    byteCount: z.number().int().positive().max(100 * 1024 * 1024),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    width: z.number().int().positive().max(32_768),
    height: z.number().int().positive().max(32_768),
  })
  .strict()
  .superRefine((value, ctx) => {
    const extension = posix.extname(value.path).slice(1);
    const expectedMime =
      extension === "png"
        ? "image/png"
        : extension === "webp"
          ? "image/webp"
          : "image/jpeg";

    if (posix.basename(value.path).split(".")[0] !== value.sha256) {
      ctx.addIssue({
        code: "custom",
        path: ["path"],
        message: "图片文件名必须与 SHA-256 一致",
      });
    }
    if (value.mimeType !== expectedMime) {
      ctx.addIssue({
        code: "custom",
        path: ["mimeType"],
        message: "图片 MIME 与扩展名不一致",
      });
    }
  });

const colorSchema = z
  .object({
    r: z.number().min(0).max(1),
    g: z.number().min(0).max(1),
    b: z.number().min(0).max(1),
    a: z.number().min(0).max(1),
  })
  .strict();

const boundsSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative().max(1_000_000),
    height: z.number().finite().nonnegative().max(1_000_000),
  })
  .strict();

const layoutSchema = z
  .object({
    direction: z.enum(["none", "horizontal", "vertical"]),
    gap: z.number().finite().nonnegative().max(100_000).optional(),
    paddingTop: z.number().finite().min(0).max(100_000).optional(),
    paddingRight: z.number().finite().min(0).max(100_000).optional(),
    paddingBottom: z.number().finite().min(0).max(100_000).optional(),
    paddingLeft: z.number().finite().min(0).max(100_000).optional(),
    alignItems: z
      .enum(["start", "center", "end", "stretch", "baseline"])
      .optional(),
    justifyContent: z
      .enum(["start", "center", "end", "space_between"])
      .optional(),
  })
  .strict();

const textSchema = z
  .object({
    characters: z.string().max(100_000),
    fontFamily: z.string().min(1).max(256).optional(),
    fontSize: z.number().positive().max(2_048).optional(),
    fontWeight: z.number().int().min(1).max(1_000).optional(),
    lineHeight: z.number().positive().max(10_000).optional(),
    letterSpacing: z.number().finite().min(-1_000).max(1_000).optional(),
    textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
  })
  .strict();

const visualMetadataSchema = z
  .object({
    opacity: z.number().min(0).max(1).optional(),
    blendMode: z.string().min(1).max(128).optional(),
    fillCount: z.number().int().nonnegative().max(10_000),
    strokeCount: z.number().int().nonnegative().max(10_000),
    effectCount: z.number().int().nonnegative().max(10_000),
    vectorPathCount: z.number().int().nonnegative().max(100_000),
    isMask: z.boolean().optional(),
    clipsContent: z.boolean().optional(),
  })
  .strict();

export const normalizedNodeSchema = z
  .object({
    id: idSchema,
    parentId: idSchema.optional(),
    kind: z.enum([
      "container",
      "text",
      "vector",
      "image",
      "instance",
      "component",
      "unsupported",
    ]),
    name: z.string().max(512).optional(),
    visible: z.boolean(),
    bounds: boundsSchema.optional(),
    layout: layoutSchema.optional(),
    text: textSchema.optional(),
    visual: visualMetadataSchema.optional(),
    componentRef: idSchema.optional(),
    styleRefs: idListSchema,
    imageRefs: z.array(safeRelativePathSchema).max(1_000),
    boundVariableRefs: z.array(sha256Schema).max(1_000),
    designValueRefs: idListSchema,
    warningCodes: z.array(z.string().min(1).max(128)).max(100),
  })
  .strict();

export const normalizedPageSchema = z
  .object({
    id: idSchema,
    name: nameSchema,
    width: z.number().finite().nonnegative().max(1_000_000),
    height: z.number().finite().nonnegative().max(1_000_000),
    rootNodeIds: idListSchema,
    nodes: z.array(normalizedNodeSchema).max(50_000),
  })
  .strict();

export const normalizedComponentSchema = z
  .object({
    id: idSchema,
    name: nameSchema,
    sourceType: z.enum(["component", "component_set"]),
    nodeId: idSchema.optional(),
    description: z.string().max(4_000).optional(),
  })
  .strict();

const typographySchema = z
  .object({
    fontFamily: z.string().min(1).max(256),
    fontSize: z.number().positive().max(2_048),
    fontWeight: z.number().int().min(1).max(1_000),
    lineHeight: z.number().positive().max(10_000),
    letterSpacing: z.number().finite().min(-1_000).max(1_000),
  })
  .strict();

export const normalizedStyleSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: idSchema,
      name: nameSchema,
      kind: z.literal("color"),
      value: colorSchema,
    })
    .strict(),
  z
    .object({
      id: idSchema,
      name: nameSchema,
      kind: z.literal("number"),
      value: z.number().finite(),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      name: nameSchema,
      kind: z.literal("typography"),
      value: typographySchema,
    })
    .strict(),
]);

const designValueBase = {
  id: idSchema,
  name: z.string().min(1).max(512),
  origin: z.enum([
    "figma_variable",
    "inferred_from_binding",
    "inferred",
  ]),
  sourceRefHash: sha256Schema.optional(),
  collection: z
    .object({
      sourceRefHash: sha256Schema,
      name: z.string().min(1).max(512),
    })
    .strict()
    .optional(),
  codeSyntax: z
    .object({
      web: z.string().min(1).max(1_000).optional(),
      android: z.string().min(1).max(1_000).optional(),
      ios: z.string().min(1).max(1_000).optional(),
    })
    .strict()
    .optional(),
};

const modeBase = {
  sourceRefHash: sha256Schema,
  name: z.string().min(1).max(512),
  aliasTargetRefHash: sha256Schema.optional(),
};

export const normalizedDesignValueSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...designValueBase,
        kind: z.literal("color"),
        value: colorSchema,
        modes: z
          .array(
            z
              .object({
                ...modeBase,
                value: colorSchema,
              })
              .strict(),
          )
          .max(100)
          .optional(),
      })
      .strict(),
    z
      .object({
        ...designValueBase,
        kind: z.literal("number"),
        value: z.number().finite(),
        modes: z
          .array(
            z
              .object({
                ...modeBase,
                value: z.number().finite(),
              })
              .strict(),
          )
          .max(100)
          .optional(),
      })
      .strict(),
    z
      .object({
        ...designValueBase,
        kind: z.literal("string"),
        value: z.string().max(4_000),
        modes: z
          .array(
            z
              .object({
                ...modeBase,
                value: z.string().max(4_000),
              })
              .strict(),
          )
          .max(100)
          .optional(),
      })
      .strict(),
    z
      .object({
        ...designValueBase,
        kind: z.literal("boolean"),
        value: z.boolean(),
        modes: z
          .array(
            z
              .object({
                ...modeBase,
                value: z.boolean(),
              })
              .strict(),
          )
          .max(100)
          .optional(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    const inferredNamePattern = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/;
    if (
      value.origin !== "figma_variable" &&
      !inferredNamePattern.test(value.name)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: "推导设计值必须使用项目内点分名称",
      });
    }
    if (value.origin === "figma_variable") {
      if (
        !value.sourceRefHash ||
        !value.collection ||
        !value.modes ||
        value.modes.length < 1
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Figma Variable 必须保留来源、集合和模式",
        });
      }
      return;
    }
    if (
      value.origin === "inferred_from_binding" &&
      !value.sourceRefHash
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceRefHash"],
        message: "绑定推导值必须保留脱敏来源",
      });
    }
    if (value.collection || value.modes || value.codeSyntax) {
      ctx.addIssue({
        code: "custom",
        message: "推导设计值不能伪造 Figma Variable 元数据",
      });
    }
  });

export const provenanceEntrySchema = z
  .object({
    entityKind: z.enum([
      "page",
      "node",
      "component",
      "style",
      "design_value",
      "asset",
      "screenshot",
    ]),
    entityId: z.string().min(1).max(512),
    origin: z.enum([
      "figma_node",
      "figma_style",
      "figma_variable",
      "inferred_from_binding",
      "inferred",
    ]),
    sourceIdHash: sha256Schema.optional(),
  })
  .strict();

export const designBundleWarningSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
    entityId: z.string().min(1).max(512).optional(),
    detail: z.string().min(1).max(2_000),
  })
  .strict();

const designBundleShape = {
  schemaVersion: z.literal(SCHEMA_VERSION),
  projectId: projectIdSchema,
  revision: z.number().int().positive(),
  source: z
    .object({
      provider: z.literal("figma_rest"),
      fileKeyHash: sha256Schema,
      targetNodeIds: idListSchema,
      inspectedAt: isoTimestampSchema,
    })
    .strict(),
  capabilities: z
    .object({
      variables: variablesCapabilitySchema,
    })
    .strict(),
  pages: z.array(normalizedPageSchema).max(1_000),
  components: z.array(normalizedComponentSchema).max(50_000),
  styles: z.array(normalizedStyleSchema).max(50_000),
  designValues: z.array(normalizedDesignValueSchema).max(50_000),
  screenshots: z.array(localImageRefSchema).max(10_000),
  assets: z.array(localImageRefSchema).max(100_000),
  provenance: z.array(provenanceEntrySchema).max(500_000),
  warnings: z.array(designBundleWarningSchema).max(10_000),
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

type DesignBundleReferenceValue = Omit<
  z.infer<z.ZodObject<typeof designBundleShape>>,
  "revision"
>;

function validateDesignBundleReferences(
  value: DesignBundleReferenceValue,
  ctx: z.RefinementCtx,
): void {
  addDuplicateIssues(
    value.pages.map((page) => page.id),
    ["pages"],
    ctx,
  );
  addDuplicateIssues(
    value.components.map((component) => component.id),
    ["components"],
    ctx,
  );
  addDuplicateIssues(
    value.styles.map((style) => style.id),
    ["styles"],
    ctx,
  );
  addDuplicateIssues(
    value.designValues.map((item) => item.id),
    ["designValues"],
    ctx,
  );
  addDuplicateIssues(
    [...value.assets, ...value.screenshots].map((image) => image.path),
    ["assets"],
    ctx,
  );

  const componentIds = new Set(value.components.map((item) => item.id));
  const styleIds = new Set(value.styles.map((item) => item.id));
  const designValueIds = new Set(
    value.designValues.map((item) => item.id),
  );
  const imagePaths = new Set(
    [...value.assets, ...value.screenshots].map((item) => item.path),
  );
  const allNodeIds = new Set<string>();

  value.pages.forEach((page, pageIndex) => {
    const nodeIds = new Set(page.nodes.map((node) => node.id));
    addDuplicateIssues(
      page.nodes.map((node) => node.id),
      ["pages", pageIndex, "nodes"],
      ctx,
    );
    for (const nodeId of nodeIds) {
      if (allNodeIds.has(nodeId)) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", pageIndex, "nodes"],
          message: `节点标识跨页面重复：${nodeId}`,
        });
      }
      allNodeIds.add(nodeId);
    }

    const rootIds = new Set(page.rootNodeIds);
    addDuplicateIssues(
      page.rootNodeIds,
      ["pages", pageIndex, "rootNodeIds"],
      ctx,
    );
    page.rootNodeIds.forEach((rootId, rootIndex) => {
      if (!nodeIds.has(rootId)) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", pageIndex, "rootNodeIds", rootIndex],
          message: `悬空根节点引用：${rootId}`,
        });
      }
    });

    const parentByNode = new Map(
      page.nodes.map((node) => [node.id, node.parentId]),
    );
    page.nodes.forEach((node, nodeIndex) => {
      if (node.parentId && !nodeIds.has(node.parentId)) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", pageIndex, "nodes", nodeIndex, "parentId"],
          message: `悬空父节点引用：${node.parentId}`,
        });
      }
      if (!node.parentId && !rootIds.has(node.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", pageIndex, "nodes", nodeIndex],
          message: "无父节点的节点必须列入 rootNodeIds",
        });
      }
      if (node.parentId && rootIds.has(node.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", pageIndex, "rootNodeIds"],
          message: `根节点不能同时具有 parentId：${node.id}`,
        });
      }
      if (node.componentRef && !componentIds.has(node.componentRef)) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", pageIndex, "nodes", nodeIndex, "componentRef"],
          message: `悬空组件引用：${node.componentRef}`,
        });
      }
      node.styleRefs.forEach((styleId, index) => {
        if (!styleIds.has(styleId)) {
          ctx.addIssue({
            code: "custom",
            path: [
              "pages",
              pageIndex,
              "nodes",
              nodeIndex,
              "styleRefs",
              index,
            ],
            message: `悬空样式引用：${styleId}`,
          });
        }
      });
      node.designValueRefs.forEach((designValueId, index) => {
        if (!designValueIds.has(designValueId)) {
          ctx.addIssue({
            code: "custom",
            path: [
              "pages",
              pageIndex,
              "nodes",
              nodeIndex,
              "designValueRefs",
              index,
            ],
            message: `悬空设计值引用：${designValueId}`,
          });
        }
      });
      node.imageRefs.forEach((imagePath, index) => {
        if (!imagePaths.has(imagePath)) {
          ctx.addIssue({
            code: "custom",
            path: [
              "pages",
              pageIndex,
              "nodes",
              nodeIndex,
              "imageRefs",
              index,
            ],
            message: `悬空图片引用：${imagePath}`,
          });
        }
      });

      const visited = new Set<string>();
      let currentId = node.id;
      while (currentId) {
        if (visited.has(currentId)) {
          ctx.addIssue({
            code: "custom",
            path: ["pages", pageIndex, "nodes", nodeIndex, "parentId"],
            message: `节点父链存在循环：${node.id}`,
          });
          break;
        }
        visited.add(currentId);
        currentId = parentByNode.get(currentId) ?? "";
      }
    });
  });

  value.components.forEach((component, index) => {
    if (component.nodeId && !allNodeIds.has(component.nodeId)) {
      ctx.addIssue({
        code: "custom",
        path: ["components", index, "nodeId"],
        message: `悬空组件节点引用：${component.nodeId}`,
      });
    }
  });

  const provenanceTargets = {
    page: new Set(value.pages.map((item) => item.id)),
    node: allNodeIds,
    component: componentIds,
    style: styleIds,
    design_value: designValueIds,
    asset: new Set(value.assets.map((item) => item.path)),
    screenshot: new Set(value.screenshots.map((item) => item.path)),
  };
  value.provenance.forEach((entry, index) => {
    if (!provenanceTargets[entry.entityKind].has(entry.entityId)) {
      ctx.addIssue({
        code: "custom",
        path: ["provenance", index, "entityId"],
        message: `悬空来源追溯引用：${entry.entityKind}:${entry.entityId}`,
      });
    }
  });
}

const designBundleObjectSchema = z.object(designBundleShape).strict();
const designBundleDraftObjectSchema = designBundleObjectSchema.omit({
  revision: true,
});

export const designBundleSchema =
  designBundleObjectSchema.superRefine(validateDesignBundleReferences);

export const designBundleDraftSchema =
  designBundleDraftObjectSchema.superRefine(
    validateDesignBundleReferences,
  );

export type VariablesCapability = z.infer<
  typeof variablesCapabilitySchema
>;
export type LocalImageRef = z.infer<typeof localImageRefSchema>;
export type NormalizedNode = z.infer<typeof normalizedNodeSchema>;
export type NormalizedPage = z.infer<typeof normalizedPageSchema>;
export type NormalizedComponent = z.infer<
  typeof normalizedComponentSchema
>;
export type NormalizedStyle = z.infer<typeof normalizedStyleSchema>;
export type NormalizedDesignValue = z.infer<
  typeof normalizedDesignValueSchema
>;
export type ProvenanceEntry = z.infer<typeof provenanceEntrySchema>;
export type DesignBundleWarning = z.infer<
  typeof designBundleWarningSchema
>;
export type DesignBundle = z.infer<typeof designBundleSchema>;
export type DesignBundleDraft = z.infer<
  typeof designBundleDraftSchema
>;
