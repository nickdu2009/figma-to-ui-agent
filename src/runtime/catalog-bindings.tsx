/**
 * 浏览器侧 Catalog 绑定组装（设计 §10.3，计划 S5）：
 * - base：@json-render/shadcn 35 个（Link 为运行时保留，不在此注册）；
 * - overlays：7 个白名单组件的升级绑定替换上游默认绑定；
 * - additions：46 个 P0 新组件；
 * - 键闭合 fail closed：additions/overlay 键集合与 CatalogContract 逐一对账，
 *   不匹配直接 throw（模块加载期错误，不静默降级）。
 *
 * 类型说明：defineRegistry 按键把每个绑定校验为 ComponentFn<C, K>
 * （BaseComponentProps<具体 props> 形状）；本文件以宽松值类型汇集，
 * 运行时由 renderer 适配层以 { props, children, emit, on, bindings } 调用
 * （与上游 shadcn 绑定同一约定）。
 */
import type { BaseComponentProps } from "@json-render/react";
import type { ReactNode } from "react";
import { shadcnComponents } from "@json-render/shadcn";

import { catalogContract } from "../catalog/catalog-contract.ts";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Carousel,
  CarouselControls,
  CarouselItem,
  Image,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Table,
} from "../catalog/components/legacy-overlays.tsx";
import {
  AppHeader,
  AppMain,
  AppShell,
  Breadcrumb,
  NavMenu,
  PageHeader,
  PageHeaderActions,
  Section,
  SectionActions,
  SectionContent,
  SectionHeader,
  Sidebar,
  Toolbar,
  ToolbarEnd,
  ToolbarStart,
} from "../catalog/components/app-shell.tsx";
import {
  Collection,
  CollectionItem,
  DataTable,
  DescriptionList,
} from "../catalog/components/data-display.tsx";
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogContent,
  AlertDialogTrigger,
  EmptyState,
  EmptyStateActions,
  ErrorState,
  Sheet,
  SheetContent,
  SheetFooter,
  SheetTrigger,
} from "../catalog/components/feedback.tsx";
import {
  Combobox,
  DatePicker,
  DateRangePicker,
  Form,
  FormSection,
  FormSectionContent,
  MultiSelect,
} from "../catalog/components/forms.tsx";
import { Icon, IconButton } from "../catalog/components/icons.tsx";

/** 浏览器组件绑定的宽松汇集类型（具体校验在 defineRegistry 按键进行）。 */
export type BrowserComponentBinding = (
  ctx: BaseComponentProps<Record<string, unknown>>,
) => ReactNode;

/** P0 additions 的 React 绑定（键与 CatalogContract additions 精确闭合）。 */
const additionBindings: Record<string, BrowserComponentBinding> = {
  /* 骨架与导航 */
  AppShell,
  Sidebar,
  AppHeader,
  AppMain,
  NavMenu,
  Breadcrumb,
  PageHeader,
  PageHeaderActions,
  Section,
  SectionHeader,
  SectionContent,
  SectionActions,
  Toolbar,
  ToolbarStart,
  ToolbarEnd,
  /* 数据展示 */
  DataTable,
  Collection,
  CollectionItem,
  DescriptionList,
  /* 反馈 */
  EmptyState,
  EmptyStateActions,
  ErrorState,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogActions,
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetFooter,
  /* 表单 */
  Form,
  FormSection,
  FormSectionContent,
  DatePicker,
  DateRangePicker,
  Combobox,
  MultiSelect,
  /* 图标 */
  Icon,
  IconButton,
  /* compound 子组件 */
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  PopoverTrigger,
  PopoverContent,
  CarouselItem,
  CarouselControls,
} as unknown as Record<string, BrowserComponentBinding>;

/** 7 个白名单组件的升级绑定（overlay 替换上游默认绑定）。 */
const overlayBindings = {
  Table,
  Select,
  Accordion,
  Popover,
  Carousel,
  Button,
  Image,
} as unknown as Record<string, BrowserComponentBinding>;

function assertClosure(): void {
  const contractAdditions = new Set(Object.keys(catalogContract.components.additions));
  const bindingAdditions = new Set(Object.keys(additionBindings));
  for (const key of contractAdditions) {
    if (!bindingAdditions.has(key)) {
      throw new Error(`P0 addition 缺少 React 绑定：${key}`);
    }
  }
  for (const key of bindingAdditions) {
    if (!contractAdditions.has(key)) {
      throw new Error(`React 绑定不对应任何 addition 合同：${key}`);
    }
  }
  const contractOverlays = new Set(Object.keys(catalogContract.components.overlays));
  const bindingOverlays = new Set(Object.keys(overlayBindings));
  for (const key of contractOverlays) {
    if (!bindingOverlays.has(key)) {
      throw new Error(`overlay 升级缺少 React 绑定：${key}`);
    }
  }
  for (const key of bindingOverlays) {
    if (!contractOverlays.has(key)) {
      throw new Error(`React 绑定不对应任何 overlay 合同：${key}`);
    }
  }
}

assertClosure();

export interface CatalogBindings {
  /** 完整 React 绑定表（base 35 + overlay 替换 7 + additions 46）。 */
  components: Record<string, BrowserComponentBinding>;
}

/** 组装浏览器侧完整绑定（模块加载期 closure 断言已通过）。 */
export function createCatalogBindings(): CatalogBindings {
  const { Link: _runtimeOwnedLink, ...base } = shadcnComponents as unknown as Record<
    string,
    BrowserComponentBinding
  >;
  return {
    components: {
      ...base,
      ...overlayBindings,
      ...additionBindings,
    },
  };
}
