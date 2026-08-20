/**
 * P0 Catalog component additions 合同（设计 §5.3/§6）：
 * - 只声明合同（props/children/events/publicStyleParts/tokenBindings/description/example），
 *   不依赖 React；S5 负责浏览器渲染绑定。
 * - additions 只可新增 optional props（可选且缺省为 undefined 的恒等性由派生器校验）；
 * - children !== "none" 在派生时映射为 json-render 原生 slots: ["default"]；
 * - compound 合法父级/唯一性/必需项关系由结构 Gate 校验，这里以机器可读元数据声明。
 */
import { z } from "zod";

import { colorLiteralSchema } from "./token-contract.ts";

/** children 合同：none=无子节点；any=任意；对象=允许组件子级清单（primitive 文本不受限）。 */
export type ChildrenContract =
  | "none"
  | "any"
  | {
      allowed: string[];
      required?: string[];
      unique?: string[];
    };

export interface ComponentContract {
  key: string;
  kind: "addition";
  props: z.ZodType;
  children: ChildrenContract;
  events: string[];
  publicStyleParts: string[];
  tokenBindings: Record<string, string>;
  description: string;
  example?: Record<string, unknown>;
}

/** Icon 名称白名单（lucide 子集，受控枚举）。 */
export const ICON_NAMES = [
  "arrow-left",
  "arrow-right",
  "arrow-up",
  "arrow-down",
  "bell",
  "calendar",
  "check",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "chevron-up",
  "clock",
  "copy",
  "download",
  "edit",
  "ellipsis",
  "external-link",
  "eye",
  "eye-off",
  "file",
  "filter",
  "folder",
  "gear",
  "home",
  "info",
  "loader",
  "lock",
  "log-out",
  "mail",
  "minus",
  "plus",
  "refresh",
  "search",
  "star",
  "trash",
  "upload",
  "user",
  "users",
  "warning",
  "x",
] as const;

export const iconNameSchema = z.enum(ICON_NAMES);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须为 YYYY-MM-DD");

const selectOptionSchema = z
  .object({
    label: z.string(),
    value: z.string(),
    description: z.string().optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

/** DataTable/Table typed column 定义（设计 §6.2/§8.1）。 */
export const typedColumnSchema = z
  .object({
    key: z.string().min(1),
    label: z.string(),
    cell: z.enum([
      "text",
      "number",
      "date",
      "badge",
      "avatar",
      "link",
      "boolean",
      "actions",
    ]),
    align: z.enum(["left", "center", "right"]).optional(),
    width: z.union([z.number(), z.string()]).optional(),
    sortable: z.boolean().optional(),
    filter: z.boolean().optional(),
  })
  .strict();

const navItemSchema = z
  .object({
    label: z.string(),
    href: z.string(),
    icon: iconNameSchema.optional(),
    badge: z.string().optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

const breadcrumbItemSchema = z
  .object({ label: z.string(), href: z.string() })
  .strict();

const descriptionListItemSchema = z
  .object({
    term: z.string(),
    description: z.string().optional(),
    format: z.enum(["text", "number", "date", "badge"]).optional(),
  })
  .strict();

function contract(input: ComponentContract): ComponentContract {
  return input;
}

/* ------------------------------------------------------------------ */
/* App 结构（§6.1）                                                    */
/* ------------------------------------------------------------------ */

const appShell = contract({
  key: "AppShell",
  kind: "addition",
  props: z.object({}).strict(),
  children: {
    allowed: ["Sidebar", "AppHeader", "AppMain"],
    required: ["AppMain"],
    unique: ["AppMain"],
  },
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description:
    "应用骨架。Sidebar 左列，AppHeader 顶栏，AppMain 主内容区；恰好一个 AppMain。",
  example: {},
});

const sidebar = contract({
  key: "Sidebar",
  kind: "addition",
  props: z
    .object({
      collapsible: z.boolean().optional(),
      defaultCollapsed: z.boolean().optional(),
      mobileDrawer: z.boolean().optional(),
    })
    .strict(),
  children: { allowed: ["NavMenu", "Breadcrumb"] },
  events: [],
  publicStyleParts: ["root", "collapsed"],
  tokenBindings: { background: "component.Sidebar.background" },
  description: "AppShell 左列导航侧栏，支持折叠与移动端抽屉。",
  example: { collapsible: true },
});

const appHeader = contract({
  key: "AppHeader",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: { background: "component.AppHeader.background" },
  description: "AppShell 顶栏，承载导航、账户和操作。",
  example: {},
});

const appMain = contract({
  key: "AppMain",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "AppShell 主内容区，承载运行时内置 Slot（页面内容注入点）。",
  example: {},
});

const navMenu = contract({
  key: "NavMenu",
  kind: "addition",
  props: z
    .object({
      items: z.array(navItemSchema),
      activeHref: z.string().optional(),
    })
    .strict(),
  children: "none",
  events: ["navigate"],
  publicStyleParts: ["root", "item", "itemActive", "icon", "badge"],
  tokenBindings: { itemActiveColor: "component.NavMenu.itemActiveColor" },
  description:
    "typed items + active route 导航菜单；支持 icon、badge、disabled，触发内置 navigate。",
  example: { items: [{ label: "首页", href: "/" }] },
});

const breadcrumb = contract({
  key: "Breadcrumb",
  kind: "addition",
  props: z.object({ items: z.array(breadcrumbItemSchema) }).strict(),
  children: "none",
  events: ["navigate"],
  publicStyleParts: ["root", "item", "separator"],
  tokenBindings: {},
  description: "面包屑导航；末项为当前页，不可点击。",
  example: { items: [{ label: "首页", href: "/" }, { label: "详情", href: "/detail" }] },
});

const pageHeader = contract({
  key: "PageHeader",
  kind: "addition",
  props: z
    .object({ title: z.string(), description: z.string().optional() })
    .strict(),
  children: { allowed: ["PageHeaderActions"], unique: ["PageHeaderActions"] },
  events: [],
  publicStyleParts: ["root", "title", "description"],
  tokenBindings: {},
  description: "页面标题区；Actions 只能作为其子组件，其余 children 为标题说明内容。",
  example: { title: "页面标题" },
});

const pageHeaderActions = contract({
  key: "PageHeaderActions",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "PageHeader 的操作区，右对齐排布按钮等操作。",
  example: {},
});

const section = contract({
  key: "Section",
  kind: "addition",
  props: z.object({}).strict(),
  children: {
    allowed: ["SectionHeader", "SectionContent", "SectionActions"],
    required: ["SectionContent"],
    unique: ["SectionHeader", "SectionContent", "SectionActions"],
  },
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "页面分区块，组合 SectionHeader/SectionContent/SectionActions。",
  example: {},
});

const sectionHeader = contract({
  key: "SectionHeader",
  kind: "addition",
  props: z
    .object({ title: z.string(), description: z.string().optional() })
    .strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root", "title", "description"],
  tokenBindings: {},
  description: "Section 标题区。",
  example: { title: "区块标题" },
});

const sectionContent = contract({
  key: "SectionContent",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "Section 内容区（必需且唯一）。",
  example: {},
});

const sectionActions = contract({
  key: "SectionActions",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "Section 操作区。",
  example: {},
});

const toolbar = contract({
  key: "Toolbar",
  kind: "addition",
  props: z.object({}).strict(),
  children: {
    allowed: ["ToolbarStart", "ToolbarEnd"],
    unique: ["ToolbarStart", "ToolbarEnd"],
  },
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "工具条，组合 ToolbarStart/ToolbarEnd 两端布局。",
  example: {},
});

const toolbarStart = contract({
  key: "ToolbarStart",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "Toolbar 起始侧。",
  example: {},
});

const toolbarEnd = contract({
  key: "ToolbarEnd",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "Toolbar 末尾侧。",
  example: {},
});

const icon = contract({
  key: "Icon",
  kind: "addition",
  props: z
    .object({
      name: iconNameSchema,
      size: z.number().optional(),
      color: colorLiteralSchema.optional(),
      decorative: z.boolean().optional(),
      label: z.string().optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.decorative !== true && !value.label) {
        ctx.addIssue({
          code: "custom",
          message: "非装饰 Icon 必须提供可访问名称 label",
          path: ["label"],
        });
      }
    }),
  children: "none",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "受控 Icon：名称白名单 + 尺寸/颜色/可访问名称；装饰用途须 decorative:true。",
  example: { name: "search", label: "搜索" },
});

const iconButton = contract({
  key: "IconButton",
  kind: "addition",
  props: z
    .object({
      iconName: iconNameSchema,
      label: z.string(),
      variant: z
        .enum(["default", "secondary", "destructive", "outline", "ghost"])
        .optional(),
      size: z.enum(["sm", "default", "lg"]).optional(),
      loading: z.boolean().optional(),
      disabled: z.boolean().optional(),
    })
    .strict(),
  children: "none",
  events: ["press"],
  publicStyleParts: ["root", "icon"],
  tokenBindings: {},
  description: "图标按钮：label 为必需可访问名称；支持 variant/size/loading/disabled。",
  example: { iconName: "plus", label: "新建" },
});

/* ------------------------------------------------------------------ */
/* 数据展示（§6.2）                                                    */
/* ------------------------------------------------------------------ */

const dataTable = contract({
  key: "DataTable",
  kind: "addition",
  props: z
    .object({
      columns: z.array(typedColumnSchema),
      queryKey: z.string().min(1),
      selectable: z.boolean().optional(),
      pageSize: z.number().int().positive().optional(),
      emptyTitle: z.string().optional(),
      emptyDescription: z.string().optional(),
    })
    .strict(),
  children: "none",
  events: ["requestData", "rowAction"],
  publicStyleParts: ["root", "header", "row", "cell", "empty", "loading"],
  tokenBindings: { headerBackground: "component.Table.headerBackground" },
  description:
    "typed columns/cells 数据表：排序、筛选、选择、行操作、loading/empty、cursor 分页；数据经受控 requestData 查询事件绑定 /runtime/queries。",
  example: {
    columns: [{ key: "name", label: "名称", cell: "text" }],
    queryKey: "items",
  },
});

const collection = contract({
  key: "Collection",
  kind: "addition",
  props: z
    .object({
      queryKey: z.string().min(1),
      emptyTitle: z.string().optional(),
      emptyDescription: z.string().optional(),
    })
    .strict(),
  children: {
    allowed: ["CollectionItem"],
    required: ["CollectionItem"],
    unique: ["CollectionItem"],
  },
  events: ["requestData"],
  publicStyleParts: ["root", "empty", "loading"],
  tokenBindings: {},
  description:
    "重复型集合：CollectionItem 为 item 模板，经 repeat/state binding 渲染；loading/empty 为受控状态。",
  example: { queryKey: "items" },
});

const collectionItem = contract({
  key: "CollectionItem",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "Collection 的单项模板。",
  example: {},
});

const descriptionList = contract({
  key: "DescriptionList",
  kind: "addition",
  props: z
    .object({
      items: z.array(descriptionListItemSchema),
      emptyText: z.string().optional(),
    })
    .strict(),
  children: "none",
  events: [],
  publicStyleParts: ["root", "term", "description"],
  tokenBindings: {},
  description: "typed items 描述列表（term/description/format），支持分组与空态文案。",
  example: { items: [{ term: "名称", description: "示例" }] },
});

const emptyState = contract({
  key: "EmptyState",
  kind: "addition",
  props: z
    .object({ title: z.string(), description: z.string().optional() })
    .strict(),
  children: { allowed: ["EmptyStateActions"], unique: ["EmptyStateActions"] },
  events: [],
  publicStyleParts: ["root", "title", "description"],
  tokenBindings: {},
  description: "空态：title/description，操作只能经 EmptyStateActions。",
  example: { title: "暂无数据" },
});

const emptyStateActions = contract({
  key: "EmptyStateActions",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "EmptyState 的操作区。",
  example: {},
});

const errorState = contract({
  key: "ErrorState",
  kind: "addition",
  props: z
    .object({
      code: z.string().optional(),
      title: z.string(),
      description: z.string().optional(),
      retryLabel: z.string().optional(),
    })
    .strict(),
  children: "none",
  events: ["retry"],
  publicStyleParts: ["root", "title", "description"],
  tokenBindings: {},
  description: "错误态：code/title/description + retry action。",
  example: { title: "加载失败", retryLabel: "重试" },
});

/* ------------------------------------------------------------------ */
/* 弹层（§6.3）                                                        */
/* ------------------------------------------------------------------ */

const openPathProp = {
  openPath: z
    .string()
    .regex(/^ui(\/[^/]+)+$/, "openPath 必须是 /ui/** 相对路径（如 ui/dialog/open）"),
} as const;

const alertDialog = contract({
  key: "AlertDialog",
  kind: "addition",
  props: z
    .object({ ...openPathProp, defaultOpen: z.boolean().optional() })
    .strict(),
  children: {
    allowed: ["AlertDialogTrigger", "AlertDialogContent"],
    required: ["AlertDialogContent"],
    unique: ["AlertDialogTrigger", "AlertDialogContent"],
  },
  events: [],
  publicStyleParts: ["overlay", "content"],
  tokenBindings: {},
  description:
    "受控确认弹窗：open 状态绑定 /ui/** openPath，openDialog/closeDialog 只写该路径。",
  example: { openPath: "ui/confirmDelete/open" },
});

const alertDialogTrigger = contract({
  key: "AlertDialogTrigger",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "AlertDialog 触发器。",
  example: {},
});

const alertDialogContent = contract({
  key: "AlertDialogContent",
  kind: "addition",
  props: z
    .object({ title: z.string(), description: z.string().optional() })
    .strict(),
  children: { allowed: ["AlertDialogActions"], unique: ["AlertDialogActions"] },
  events: [],
  publicStyleParts: ["root", "title", "description"],
  tokenBindings: {},
  description: "AlertDialog 内容（title/description + AlertDialogActions）。",
  example: { title: "确认操作" },
});

const alertDialogActions = contract({
  key: "AlertDialogActions",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "AlertDialog 操作区。",
  example: {},
});

const sheet = contract({
  key: "Sheet",
  kind: "addition",
  props: z
    .object({
      ...openPathProp,
      defaultOpen: z.boolean().optional(),
      side: z.enum(["left", "right", "bottom"]).optional(),
    })
    .strict(),
  children: {
    allowed: ["SheetTrigger", "SheetContent"],
    required: ["SheetContent"],
    unique: ["SheetTrigger", "SheetContent"],
  },
  events: [],
  publicStyleParts: ["overlay", "content"],
  tokenBindings: {},
  description: "受控侧弹层：open 状态绑定 /ui/** openPath；side 仅 left/right/bottom。",
  example: { openPath: "ui/detail/open", side: "right" },
});

const sheetTrigger = contract({
  key: "SheetTrigger",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "Sheet 触发器。",
  example: {},
});

const sheetContent = contract({
  key: "SheetContent",
  kind: "addition",
  props: z.object({ title: z.string().optional() }).strict(),
  children: { allowed: ["SheetFooter"], unique: ["SheetFooter"] },
  events: [],
  publicStyleParts: ["root", "title"],
  tokenBindings: {},
  description: "Sheet 内容（可含唯一 SheetFooter）。",
  example: { title: "详情" },
});

const sheetFooter = contract({
  key: "SheetFooter",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "Sheet 底部操作区。",
  example: {},
});

/* ------------------------------------------------------------------ */
/* 表单（§6.4）                                                        */
/* ------------------------------------------------------------------ */

const form = contract({
  key: "Form",
  kind: "addition",
  props: z
    .object({
      formId: z.string().min(1),
      schemaRef: z.string().min(1),
      submitLabel: z.string().optional(),
      resetLabel: z.string().optional(),
      disabled: z.boolean().optional(),
    })
    .strict(),
  children: { allowed: ["FormSection"] },
  events: ["submit", "reset", "error"],
  publicStyleParts: ["root", "actions"],
  tokenBindings: {},
  description:
    "受控表单：formId/schemaRef（collectionKey）；字段值写 /runtime/forms/<formId>/values/**；submit/reset/error 语义受控。",
  example: { formId: "editItem", schemaRef: "items" },
});

const formSection = contract({
  key: "FormSection",
  kind: "addition",
  props: z
    .object({ title: z.string(), description: z.string().optional() })
    .strict(),
  children: {
    allowed: ["FormSectionContent"],
    required: ["FormSectionContent"],
    unique: ["FormSectionContent"],
  },
  events: [],
  publicStyleParts: ["root", "title", "description"],
  tokenBindings: {},
  description: "表单分区块（含唯一 FormSectionContent）。",
  example: { title: "基本信息" },
});

const formSectionContent = contract({
  key: "FormSectionContent",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "表单区块内容，承载字段组件。",
  example: {},
});

const datePicker = contract({
  key: "DatePicker",
  kind: "addition",
  props: z
    .object({
      name: z.string().min(1),
      label: z.string().optional(),
      value: isoDateSchema.optional(),
      min: isoDateSchema.optional(),
      max: isoDateSchema.optional(),
      disabledDates: z.array(isoDateSchema).optional(),
      locale: z.string().optional(),
      disabled: z.boolean().optional(),
    })
    .strict(),
  children: "none",
  events: ["change"],
  publicStyleParts: ["root", "input", "calendar"],
  tokenBindings: {},
  description: "受控 DatePicker：ISO YYYY-MM-DD value + min/max/disabledDates/locale。",
  example: { name: "dueDate", label: "截止日期" },
});

const dateRangePicker = contract({
  key: "DateRangePicker",
  kind: "addition",
  props: z
    .object({
      name: z.string().min(1),
      label: z.string().optional(),
      value: z
        .object({ from: isoDateSchema, to: isoDateSchema })
        .strict()
        .optional(),
      min: isoDateSchema.optional(),
      max: isoDateSchema.optional(),
      locale: z.string().optional(),
      disabled: z.boolean().optional(),
    })
    .strict(),
  children: "none",
  events: ["change"],
  publicStyleParts: ["root", "input", "calendar"],
  tokenBindings: {},
  description: "受控 DateRangePicker：{from,to} 值 + min/max/locale。",
  example: { name: "period", label: "周期" },
});

const combobox = contract({
  key: "Combobox",
  kind: "addition",
  props: z
    .object({
      name: z.string().min(1),
      label: z.string().optional(),
      options: z.array(selectOptionSchema),
      value: z.string().optional(),
      placeholder: z.string().optional(),
      loading: z.boolean().optional(),
      emptyText: z.string().optional(),
      disabled: z.boolean().optional(),
    })
    .strict(),
  children: "none",
  events: ["change"],
  publicStyleParts: ["root", "input", "option"],
  tokenBindings: {},
  description: "typed options Combobox，本地过滤受控；支持 loading/emptyText。",
  example: { name: "assignee", options: [{ label: "张三", value: "u1" }] },
});

const multiSelect = contract({
  key: "MultiSelect",
  kind: "addition",
  props: z
    .object({
      name: z.string().min(1),
      label: z.string().optional(),
      options: z.array(selectOptionSchema),
      value: z.array(z.string()).optional(),
      maxCount: z.number().int().positive().optional(),
      chips: z.boolean().optional(),
      loading: z.boolean().optional(),
      emptyText: z.string().optional(),
      disabled: z.boolean().optional(),
    })
    .strict(),
  children: "none",
  events: ["change"],
  publicStyleParts: ["root", "chip", "option"],
  tokenBindings: {},
  description: "typed options MultiSelect：chips/maxCount/loading/emptyText。",
  example: { name: "tags", options: [{ label: "重要", value: "important" }] },
});

/* ------------------------------------------------------------------ */
/* Compound additions（§8.2/§8.3 的 compound 组件，作为新组件声明）      */
/* ------------------------------------------------------------------ */

const accordionItem = contract({
  key: "AccordionItem",
  kind: "addition",
  props: z
    .object({
      value: z.string().min(1),
      defaultOpen: z.boolean().optional(),
    })
    .strict(),
  children: {
    allowed: ["AccordionTrigger", "AccordionContent"],
    required: ["AccordionTrigger", "AccordionContent"],
    unique: ["AccordionTrigger", "AccordionContent"],
  },
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "Accordion 的受控项：value 唯一标识；恰好一对 Trigger/Content。",
  example: { value: "item-1" },
});

const accordionTrigger = contract({
  key: "AccordionTrigger",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: ["press"],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "AccordionItem 触发区。",
  example: {},
});

const accordionContent = contract({
  key: "AccordionContent",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "AccordionItem 内容区。",
  example: {},
});

const popoverTrigger = contract({
  key: "PopoverTrigger",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "Popover 触发器（compound 模式）。",
  example: {},
});

const popoverContent = contract({
  key: "PopoverContent",
  kind: "addition",
  props: z
    .object({
      align: z.enum(["start", "center", "end"]).optional(),
      side: z.enum(["top", "right", "bottom", "left"]).optional(),
    })
    .strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "Popover 内容（compound 模式）。",
  example: {},
});

const carouselItem = contract({
  key: "CarouselItem",
  kind: "addition",
  props: z.object({}).strict(),
  children: "any",
  events: [],
  publicStyleParts: ["root"],
  tokenBindings: {},
  description: "Carousel 单项（compound 模式）。",
  example: {},
});

const carouselControls = contract({
  key: "CarouselControls",
  kind: "addition",
  props: z
    .object({
      prevLabel: z.string().optional(),
      nextLabel: z.string().optional(),
    })
    .strict(),
  children: "none",
  events: [],
  publicStyleParts: ["root", "prev", "next"],
  tokenBindings: {},
  description: "Carousel 前后控制（compound 模式）。",
  example: {},
});

/** P0 component additions 全量清单。 */
export const p0ComponentAdditions: readonly ComponentContract[] = [
  appShell,
  sidebar,
  appHeader,
  appMain,
  navMenu,
  breadcrumb,
  pageHeader,
  pageHeaderActions,
  section,
  sectionHeader,
  sectionContent,
  sectionActions,
  toolbar,
  toolbarStart,
  toolbarEnd,
  icon,
  iconButton,
  dataTable,
  collection,
  collectionItem,
  descriptionList,
  emptyState,
  emptyStateActions,
  errorState,
  alertDialog,
  alertDialogTrigger,
  alertDialogContent,
  alertDialogActions,
  sheet,
  sheetTrigger,
  sheetContent,
  sheetFooter,
  form,
  formSection,
  formSectionContent,
  datePicker,
  dateRangePicker,
  combobox,
  multiSelect,
  accordionItem,
  accordionTrigger,
  accordionContent,
  popoverTrigger,
  popoverContent,
  carouselItem,
  carouselControls,
];
