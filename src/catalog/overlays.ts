/**
 * 现有组件 overlay 合同（设计 §5.3/§8）：
 * - 只对 7 个白名单组件（Table、Select、Accordion、Popover、Carousel、Button、Image）；
 * - additions 只能新增纯 optional Prop（解析 undefined 后仍为 undefined）；
 * - widenings 只以 z.union([basePropSchema, preferredSchema]) 机械合并，base 分支优先，
 *   且必须带 legacy/preferred 夹具供派生器验证两个分支都按设计解析；
 * - childrenExtension 只扩展、不收缩（preserveBase: true）；
 * - events/styleParts 只增不删；tokenBindings 只新增 key，不得覆盖既有绑定。
 */
import { z } from "zod";

import { iconNameSchema, typedColumnSchema } from "./component-contracts.ts";

export interface PropWidening {
  preferredSchema: z.ZodType;
  legacyFixture: unknown;
  preferredFixture: unknown;
}

export interface ExistingComponentOverlay {
  props?: {
    additions?: Record<string, z.ZodType>;
    widenings?: Record<string, PropWidening>;
  };
  childrenExtension?: {
    preserveBase: true;
    additions: string[];
    requiredWhenPresent?: Record<string, string[]>;
    uniqueAdditions?: string[];
  };
  eventAdditions?: string[];
  publicStylePartAdditions?: string[];
  tokenBindingAdditions?: Record<string, string>;
}

/** Select/Combobox 风格 typed option。 */
const typedOptionSchema = z
  .object({
    label: z.string(),
    value: z.string(),
    description: z.string().optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

const tableOverlay: ExistingComponentOverlay = {
  props: {
    additions: {
      queryKey: z.string().min(1).optional(),
      selectable: z.boolean().optional(),
      loading: z.boolean().optional(),
      emptyTitle: z.string().optional(),
      errorTitle: z.string().optional(),
    },
    widenings: {
      columns: {
        preferredSchema: z.array(typedColumnSchema),
        legacyFixture: ["名称", "状态"],
        preferredFixture: [
          { key: "name", label: "名称", cell: "text" },
          { key: "status", label: "状态", cell: "badge" },
        ],
      },
    },
  },
  eventAdditions: ["requestData", "rowAction"],
  publicStylePartAdditions: ["empty", "loading"],
  tokenBindingAdditions: { headerBackground: "component.Table.headerBackground" },
};

const selectOverlay: ExistingComponentOverlay = {
  props: {
    widenings: {
      options: {
        preferredSchema: z.array(
          z.union([z.string(), typedOptionSchema]),
        ),
        legacyFixture: ["标准", "加急"],
        preferredFixture: [
          { label: "标准", value: "standard" },
          { label: "加急", value: "express", description: "1 个工作日内" },
        ],
      },
    },
  },
};

const accordionOverlay: ExistingComponentOverlay = {
  childrenExtension: {
    preserveBase: true,
    additions: ["AccordionItem", "AccordionTrigger", "AccordionContent"],
    requiredWhenPresent: {
      AccordionItem: ["AccordionTrigger", "AccordionContent"],
    },
  },
};

const popoverOverlay: ExistingComponentOverlay = {
  childrenExtension: {
    preserveBase: true,
    additions: ["PopoverTrigger", "PopoverContent"],
    requiredWhenPresent: {
      PopoverTrigger: ["PopoverContent"],
      PopoverContent: ["PopoverTrigger"],
    },
  },
};

const carouselOverlay: ExistingComponentOverlay = {
  childrenExtension: {
    preserveBase: true,
    additions: ["CarouselItem", "CarouselControls"],
    requiredWhenPresent: {
      CarouselControls: ["CarouselItem"],
    },
    uniqueAdditions: ["CarouselControls"],
  },
};

const buttonOverlay: ExistingComponentOverlay = {
  props: {
    additions: {
      size: z.enum(["sm", "default", "lg"]).optional(),
      icon: iconNameSchema.optional(),
      iconPosition: z.enum(["left", "right"]).optional(),
      loading: z.boolean().optional(),
      type: z.enum(["button", "submit", "reset"]).optional(),
      fullWidth: z.boolean().optional(),
    },
  },
  publicStylePartAdditions: ["icon"],
};

const imageOverlay: ExistingComponentOverlay = {
  props: {
    additions: {
      objectFit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
      objectPosition: z.string().optional(),
      aspectRatio: z.string().optional(),
      radius: z.union([z.number(), z.string()]).optional(),
      loading: z.enum(["lazy", "eager"]).optional(),
      decorative: z.boolean().optional(),
      assetRef: z
        .object({
          assetId: z.string().min(1),
          contentHash: z
            .string()
            .regex(/^sha256:[0-9a-f]{64}$/, "contentHash 必须是 sha256:<64 位小写十六进制>"),
        })
        .strict()
        .optional(),
    },
  },
};

/** 7 个白名单组件的 overlay。 */
export const p0ComponentOverlays = {
  Table: tableOverlay,
  Select: selectOverlay,
  Accordion: accordionOverlay,
  Popover: popoverOverlay,
  Carousel: carouselOverlay,
  Button: buttonOverlay,
  Image: imageOverlay,
} as const satisfies Record<string, ExistingComponentOverlay>;

export const P0_OVERLAY_COMPONENT_NAMES = Object.keys(p0ComponentOverlays);
