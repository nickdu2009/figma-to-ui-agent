import type { AppPlan } from "./contracts.ts";

// 相对导入使用显式 .ts 扩展名：服务端以 Node 24 类型剥离直接运行。
// tsconfig 已启用 allowImportingTsExtensions；tsc --noEmit 通过。

/**
 * Mock Agent 的静态夹具（不调 LLM）：
 * - cannedPlan：run1 ask_question 内嵌的权威计划；
 * - createPatchLines：base=empty 时从空对象构建三路由应用的 RFC 6902 JSONL；
 * - editPatchLines：base=current 时对 /pricing 页面的合法增量；
 * - brokenPatchLines：非法 JSONL，用于验证运行时拒绝并保留旧预览。
 *
 * NextAppSpec 元素形态以 tests/browser/preview.spec.ts 为准：
 * Stack props 全键（direction/gap/align/justify/className，可 null），
 * Text 需要 text/variant，Link 用 { href } props + Text 子元素，
 * Card 需要 title/description/maxWidth/centered/className 全键，
 * Heading 需要 text/level。
 *
 * JSON Pointer 转义："/routes/~1" 表示路由 "/"；"/routes/~1pricing" 表示 "/pricing"。
 */

export const cannedPlan: AppPlan = {
  goal: "构建 Acme 产品站点（首页 / 定价 / 文档）",
  pages: ["首页", "定价", "文档"],
  structure: [
    "根布局包含导航（首页、定价两个 Link）与 Slot",
    "首页为欢迎标题",
    "定价页为方案卡片",
    "文档页为开发文档标题",
  ],
  style: "简洁浅色风格，垂直 Stack 布局",
};

const stackProps = {
  direction: "vertical",
  gap: "md",
  align: null,
  justify: null,
  className: null,
} as const;

const cardProps = (title: string, description: string) => ({
  title,
  description,
  maxWidth: "sm",
  centered: true,
  className: null,
});

/** RFC 6902 op；value 为任意 JSON。 */
type PatchOp = {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
};

const toJsonl = (ops: PatchOp[]): string[] =>
  ops.map((op) => JSON.stringify(op) + "\n");

export const createOps: PatchOp[] = [
  {
    op: "add",
    path: "/metadata",
    value: { title: { default: "Acme", template: "%s | Acme" } },
  },
  {
    op: "add",
    path: "/layouts",
    value: {
      root: {
        root: "nav",
        elements: {
          nav: {
            type: "Stack",
            props: stackProps,
            children: ["homeLink", "pricingLink", "slot"],
          },
          homeLink: {
            type: "Link",
            props: { href: "/" },
            children: ["homeLabel"],
          },
          homeLabel: {
            type: "Text",
            props: { text: "首页", variant: null },
            children: [],
          },
          pricingLink: {
            type: "Link",
            props: { href: "/pricing" },
            children: ["pricingLabel"],
          },
          pricingLabel: {
            type: "Text",
            props: { text: "定价", variant: null },
            children: [],
          },
          slot: { type: "Slot", props: {}, children: [] },
        },
      },
    },
  },
  { op: "add", path: "/routes", value: {} },
  {
    op: "add",
    path: "/routes/~1",
    value: {
      metadata: { title: "首页" },
      layout: "root",
      page: {
        root: "r1",
        elements: {
          r1: { type: "Stack", props: stackProps, children: ["h"] },
          h: {
            type: "Heading",
            props: { text: "欢迎使用 Acme", level: "h1" },
            children: [],
          },
        },
      },
    },
  },
  {
    op: "add",
    path: "/routes/~1pricing",
    value: {
      metadata: { title: "定价" },
      layout: "root",
      page: {
        root: "r1",
        elements: {
          r1: { type: "Stack", props: stackProps, children: ["card1"] },
          card1: {
            type: "Card",
            props: cardProps("基础版", "适合个人开发者"),
            children: [],
          },
        },
      },
    },
  },
  {
    op: "add",
    path: "/routes/~1docs",
    value: {
      metadata: { title: "文档" },
      layout: "root",
      page: {
        root: "r2",
        elements: {
          r2: { type: "Stack", props: stackProps, children: ["h2"] },
          h2: {
            type: "Heading",
            props: { text: "开发文档", level: "h2" },
            children: [],
          },
        },
      },
    },
  },
];

/** base=empty：从空对象构建三路由应用（每行一个合法 RFC 6902 op，行末带 \n）。 */
export const createPatchLines: string[] = toJsonl(createOps);

export const editOps: PatchOp[] = [
  {
    op: "add",
    path: "/routes/~1pricing/page/elements/card2",
    value: {
      type: "Card",
      props: cardProps("专业版", "适合成长中的团队"),
      children: [],
    },
  },
  {
    op: "add",
    path: "/routes/~1pricing/page/elements/r1/children/-",
    value: "card2",
  },
];

/** base=current：向 /pricing 页面追加第二张 Card（每行一个合法 op，行末带 \n）。 */
export const editPatchLines: string[] = toJsonl(editOps);

/**
 * 非法 JSONL：首行在 value 中途被截断，JSON.parse 必然失败；
 * 用于验证运行时拒绝坏补丁并保留最后一份有效预览。
 */
export const brokenPatchLines: string[] = [
  '{"op":"add","path":"/routes","value":{"bad":\n',
];
