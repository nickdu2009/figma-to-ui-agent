/**
 * 应用骨架与导航组件（设计 §7.1，计划 S5）：
 * - AppShell：单一 children（Sidebar/AppHeader/AppMain），compound 结构
 *   由 Catalog 结构 Gate 校验；
 * - 所有组件不 fetch、不持有业务事实；
 * - Sidebar collapsed 状态是组件本地 UI 态（不进入 /runtime 状态）。
 */
import { useCallback, useState, type ReactNode } from "react";

import { IconGlyph } from "./icons.tsx";
import { catalogMessage } from "./messages.ts";

type BaseProps<P> = {
  props: P;
  children?: ReactNode;
  on: (event: string) => { emit: () => void; shouldPreventDefault: boolean };
};

/* ---------------- AppShell ---------------- */

export function AppShell({ children }: BaseProps<Record<string, never>>) {
  return (
    <div className="vma-app-shell" data-vma-style-part="root">
      {children}
    </div>
  );
}

/* ---------------- Sidebar ---------------- */

export function Sidebar({
  props,
  children,
}: BaseProps<{
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  mobileDrawer?: boolean;
}>) {
  const [collapsed, setCollapsed] = useState(props.defaultCollapsed ?? false);
  const canCollapse = props.collapsible === true;
  const onToggle = useCallback(() => {
    if (canCollapse) setCollapsed((value) => !value);
  }, [canCollapse]);
  return (
    <aside
      className={`vma-sidebar${collapsed ? " vma-sidebar--collapsed" : ""}`}
      data-vma-style-part={collapsed ? "collapsed" : "root"}
      data-collapsed={collapsed ? "true" : "false"}
    >
      {canCollapse ? (
        <button
          type="button"
          className="vma-sidebar-toggle"
          aria-label={collapsed ? catalogMessage("sidebar.expand") : catalogMessage("sidebar.collapse")}
          aria-pressed={collapsed}
          onClick={onToggle}
        >
          {IconGlyph({
            name: collapsed ? "chevron-right" : "chevron-left",
            decorative: true,
          })}
        </button>
      ) : null}
      <div className="vma-sidebar-content">{children}</div>
    </aside>
  );
}

/* ---------------- AppHeader ---------------- */

export function AppHeader({ children }: BaseProps<Record<string, never>>) {
  return (
    <header className="vma-app-header" data-vma-style-part="root">
      {children}
    </header>
  );
}

/* ---------------- AppMain ---------------- */

export function AppMain({ children }: BaseProps<Record<string, never>>) {
  return (
    <main className="vma-app-main" data-vma-style-part="root">
      {children}
    </main>
  );
}

/* ---------------- NavMenu ---------------- */

export interface NavMenuItem {
  label: string;
  href: string;
  icon?: string;
  badge?: string;
  disabled?: boolean;
}

export function NavMenu({
  props,
  on,
}: BaseProps<{ items: NavMenuItem[]; activeHref?: string }>) {
  const items = props.items ?? [];
  const activeHref = props.activeHref ?? null;
  return (
    <nav
      className="vma-nav-menu"
      data-vma-style-part="root"
      aria-label={catalogMessage("nav.label")}
    >
      <ul className="vma-nav-menu-list">
        {items.map((item) => {
          const active = activeHref !== null && item.href === activeHref;
          const content = (
            <>
              {item.icon
                ? IconGlyph({ name: item.icon, decorative: true })
                : null}
              <span className="vma-nav-menu-label" data-vma-style-part="item">
                {item.label}
              </span>
              {item.badge ? (
                <span
                  className="vma-nav-menu-badge"
                  data-vma-style-part="badge"
                >
                  {item.badge}
                </span>
              ) : null}
            </>
          );
          return (
            <li key={`${item.href}:${item.label}`}>
              <a
                className={`vma-nav-menu-item${active ? " vma-nav-menu-item--active" : ""}`}
                data-vma-style-part={active ? "itemActive" : "item"}
                href={item.disabled ? undefined : item.href}
                aria-disabled={item.disabled ? true : undefined}
                aria-current={active ? "page" : undefined}
                data-vma-icon={item.icon}
                onClick={(event) => {
                  if (item.disabled) {
                    event.preventDefault();
                    return;
                  }
                  const press = on("navigate");
                  if (press.shouldPreventDefault) event.preventDefault();
                  press.emit();
                }}
              >
                {content}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ---------------- Breadcrumb ---------------- */

export interface BreadcrumbItem {
  label: string;
  href: string;
}

export function Breadcrumb({
  props,
  on,
}: BaseProps<{ items: BreadcrumbItem[] }>) {
  const items = props.items ?? [];
  return (
    <nav
      className="vma-breadcrumb"
      data-vma-style-part="root"
      aria-label={catalogMessage("breadcrumb.label")}
    >
      <ol className="vma-breadcrumb-list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li
              key={`${item.href}:${item.label}`}
              className="vma-breadcrumb-item"
              data-vma-style-part="item"
            >
              {isLast ? (
                <span aria-current="page">{item.label}</span>
              ) : (
                <a
                  href={item.href}
                  onClick={(event) => {
                    const press = on("navigate");
                    if (press.shouldPreventDefault) event.preventDefault();
                    press.emit();
                  }}
                >
                  {item.label}
                </a>
              )}
              {isLast ? null : (
                <span
                  className="vma-breadcrumb-separator"
                  data-vma-style-part="separator"
                  aria-hidden="true"
                >
                  {IconGlyph({
                    name: "chevron-right",
                    size: 12,
                    decorative: true,
                  })}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------------- PageHeader / PageHeaderActions ---------------- */

export function PageHeader({
  props,
  children,
}: BaseProps<{ title: string; description?: string }>) {
  return (
    <div className="vma-page-header" data-vma-style-part="root">
      <div className="vma-page-header-main">
        <h1 className="vma-page-header-title" data-vma-style-part="title">
          {props.title}
        </h1>
        {props.description ? (
          <p
            className="vma-page-header-description"
            data-vma-style-part="description"
          >
            {props.description}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function PageHeaderActions({
  children,
}: BaseProps<Record<string, never>>) {
  return (
    <div className="vma-page-header-actions" data-vma-style-part="root">
      {children}
    </div>
  );
}

/* ---------------- Section family ---------------- */

export function Section({ children }: BaseProps<Record<string, never>>) {
  return (
    <section className="vma-section" data-vma-style-part="root">
      {children}
    </section>
  );
}

export function SectionHeader({
  props,
  children,
}: BaseProps<{ title: string; description?: string }>) {
  return (
    <div className="vma-section-header" data-vma-style-part="root">
      <h2 className="vma-section-header-title" data-vma-style-part="title">
        {props.title}
      </h2>
      {props.description ? (
        <p
          className="vma-section-header-description"
          data-vma-style-part="description"
        >
          {props.description}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export function SectionContent({ children }: BaseProps<Record<string, never>>) {
  return (
    <div className="vma-section-content" data-vma-style-part="root">
      {children}
    </div>
  );
}

export function SectionActions({ children }: BaseProps<Record<string, never>>) {
  return (
    <div className="vma-section-actions" data-vma-style-part="root">
      {children}
    </div>
  );
}

/* ---------------- Toolbar family ---------------- */

export function Toolbar({ children }: BaseProps<Record<string, never>>) {
  return (
    <div className="vma-toolbar" data-vma-style-part="root" role="toolbar">
      {children}
    </div>
  );
}

export function ToolbarStart({ children }: BaseProps<Record<string, never>>) {
  return (
    <div className="vma-toolbar-start" data-vma-style-part="root">
      {children}
    </div>
  );
}

export function ToolbarEnd({ children }: BaseProps<Record<string, never>>) {
  return (
    <div className="vma-toolbar-end" data-vma-style-part="root">
      {children}
    </div>
  );
}
