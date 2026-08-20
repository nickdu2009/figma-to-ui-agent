/**
 * P0 Catalog 组件的受控国际化层（计划 S5 + 用户要求：新加组件需要国际化）：
 * - 所有组件内用户可见字符串（loading/empty/placeholder/aria-label）经本层
 *   查找，组件内不硬编码文案；
 * - 不引入外部 i18n 依赖；内置 zh-CN / en 两套完整词典；
 * - 宿主可经 setCatalogLocale / overrideCatalogMessages 覆盖（例如按用户
 *   偏好或未来服务端配置）；缺省 zh-CN 与现有验收断言一致；
 * - 消息支持 {name} 占位参数（确定性替换，不执行任何格式化代码）；
 * - 缺失 key 时 fail closed 回退 zh-CN 词典的同一 key（仍缺失则回退
 *   key 本身），保证渲染永不因文案缺失崩溃。
 */

export type CatalogMessageKey =
  | "nav.label"
  | "breadcrumb.label"
  | "sidebar.expand"
  | "sidebar.collapse"
  | "common.loading"
  | "common.loadFailed"
  | "common.refreshing"
  | "common.emptyTitle"
  | "common.emptyValue"
  | "common.emptyInfo"
  | "common.retry"
  | "common.close"
  | "common.selectPlaceholder"
  | "common.noMatch"
  | "common.noOptions"
  | "boolean.true"
  | "boolean.false"
  | "dialog.closePanel"
  | "dialog.sidePanel"
  | "form.submit"
  | "form.reset"
  | "form.dateFrom"
  | "form.dateTo"
  | "form.dateRangeInvalid"
  | "form.removeChip"
  | "carousel.region"
  | "carousel.positionLabel"
  | "carousel.position"
  | "carousel.prev"
  | "carousel.next"
  | "multiselect.selectedCount";

export type CatalogLocale = string;

export interface CatalogMessages {
  locale: CatalogLocale;
  messages: Record<CatalogMessageKey, string>;
}

const zhCN: CatalogMessages = {
  locale: "zh-CN",
  messages: {
    "nav.label": "应用导航",
    "breadcrumb.label": "面包屑",
    "sidebar.expand": "展开侧栏",
    "sidebar.collapse": "折叠侧栏",
    "common.loading": "加载中…",
    "common.loadFailed": "加载失败",
    "common.refreshing": "刷新中…",
    "common.emptyTitle": "暂无数据",
    "common.emptyValue": "—",
    "common.emptyInfo": "暂无信息",
    "common.retry": "重试",
    "common.close": "关闭",
    "common.selectPlaceholder": "请选择",
    "common.noMatch": "无匹配项",
    "common.noOptions": "无可选项",
    "boolean.true": "是",
    "boolean.false": "否",
    "dialog.closePanel": "关闭面板",
    "dialog.sidePanel": "侧边面板",
    "form.submit": "提交",
    "form.reset": "重置",
    "form.dateFrom": "开始日期",
    "form.dateTo": "结束日期",
    "form.dateRangeInvalid": "结束日期不能早于开始日期",
    "form.removeChip": "移除 {label}",
    "carousel.region": "轮播",
    "carousel.positionLabel": "轮播位置",
    "carousel.position": "第 {index} 项",
    "carousel.prev": "上一项",
    "carousel.next": "下一项",
    "multiselect.selectedCount": "{count} 项已选",
  },
};

const en: CatalogMessages = {
  locale: "en",
  messages: {
    "nav.label": "App navigation",
    "breadcrumb.label": "Breadcrumb",
    "sidebar.expand": "Expand sidebar",
    "sidebar.collapse": "Collapse sidebar",
    "common.loading": "Loading…",
    "common.loadFailed": "Failed to load",
    "common.refreshing": "Refreshing…",
    "common.emptyTitle": "No data yet",
    "common.emptyValue": "—",
    "common.emptyInfo": "No information available",
    "common.retry": "Retry",
    "common.close": "Close",
    "common.selectPlaceholder": "Select…",
    "common.noMatch": "No matches",
    "common.noOptions": "No options",
    "boolean.true": "Yes",
    "boolean.false": "No",
    "dialog.closePanel": "Close panel",
    "dialog.sidePanel": "Side panel",
    "form.submit": "Submit",
    "form.reset": "Reset",
    "form.dateFrom": "Start date",
    "form.dateTo": "End date",
    "form.dateRangeInvalid": "End date cannot be earlier than start date",
    "form.removeChip": "Remove {label}",
    "carousel.region": "Carousel",
    "carousel.positionLabel": "Carousel position",
    "carousel.position": "Item {index}",
    "carousel.prev": "Previous",
    "carousel.next": "Next",
    "multiselect.selectedCount": "{count} selected",
  },
};

const BUILTIN_LOCALES: Record<string, CatalogMessages> = {
  "zh-CN": zhCN,
  en,
};

const FALLBACK_LOCALE = "zh-CN";

let currentMessages: CatalogMessages = zhCN;

function fallbackTable(): Record<string, CatalogMessages> {
  return BUILTIN_LOCALES;
}

/** 宿主设置 locale（接受内置键或已注册的自定义词典）。 */
export function setCatalogLocale(locale: CatalogLocale): void {
  const table = fallbackTable();
  currentMessages = table[locale] ?? table[FALLBACK_LOCALE] ?? zhCN;
}

/** 注册自定义词典（键闭合：必须覆盖全部 key 才接受）。 */
export function registerCatalogMessages(input: CatalogMessages): void {
  for (const key of Object.keys(zhCN.messages) as CatalogMessageKey[]) {
    if (typeof input.messages[key] !== "string") {
      throw new Error(`catalog messages 缺少 key：${key}`);
    }
  }
  BUILTIN_LOCALES[input.locale] = input;
}

/** 当前 locale（诊断用）。 */
export function getCatalogLocale(): CatalogLocale {
  return currentMessages.locale;
}

/** 查找消息并做 {name} 占位替换（确定性字符串替换，无代码执行）。 */
export function catalogMessage(
  key: CatalogMessageKey,
  params?: Record<string, string | number>,
): string {
  let template: string | undefined = currentMessages.messages[key];
  if (typeof template !== "string") {
    template = fallbackTable()[FALLBACK_LOCALE]?.messages[key];
  }
  if (typeof template !== "string") template = zhCN.messages[key];
  if (typeof template !== "string") return key;
  if (!params) return template;
  let result = template;
  for (const [name, value] of Object.entries(params)) {
    result = result.replaceAll(`{${name}}`, String(value));
  }
  return result;
}

/** 测试用内置词典快照（不参与运行时查找；键闭合测试消费）。 */
export const BUILTIN_MESSAGES_ZH_CN_FOR_TEST: Record<string, string> = {
  ...zhCN.messages,
};

export const BUILTIN_MESSAGES_EN_FOR_TEST: Record<string, string> = {
  ...en.messages,
};
