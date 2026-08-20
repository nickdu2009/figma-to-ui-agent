/**
 * 状态反馈组件（设计 §7.4，计划 S5）：
 * - EmptyState/ErrorState：受控空态/错误态；
 * - AlertDialog/Sheet：受控开关（open 状态绑定 /ui/** openPath，
 *   与 openDialog/closeDialog Action 闭合）；
 * - ToastViewport 不在此处——它是 Host 内部设施，不进入 Catalog。
 */
import type { ReactNode } from "react";
import { useStateBinding } from "@json-render/react";

import { IconGlyph } from "./icons.tsx";
import { catalogMessage } from "./messages.ts";

type BaseProps<P> = {
  props: P;
  children?: ReactNode;
  on: (event: string) => {
    emit: () => void;
    shouldPreventDefault: boolean;
    bound: boolean;
  };
};

/* ---------------- EmptyState ---------------- */

export function EmptyState({
  props,
  children,
}: BaseProps<{ title: string; description?: string }>) {
  return (
    <div className="vma-empty-state" data-vma-style-part="root">
      <div className="vma-empty-state-icon" aria-hidden="true">
        {IconGlyph({ name: "folder", size: 32, decorative: true })}
      </div>
      <p className="vma-empty-state-title" data-vma-style-part="title">
        {props.title}
      </p>
      {props.description ? (
        <p
          className="vma-empty-state-description"
          data-vma-style-part="description"
        >
          {props.description}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export function EmptyStateActions({
  children,
}: BaseProps<Record<string, never>>) {
  return (
    <div className="vma-empty-state-actions" data-vma-style-part="root">
      {children}
    </div>
  );
}

/* ---------------- ErrorState ---------------- */

export function ErrorState({
  props,
  on,
}: BaseProps<{
  code?: string;
  title: string;
  description?: string;
  retryLabel?: string;
}>) {
  return (
    <div className="vma-error-state" data-vma-style-part="root" role="alert">
      <div className="vma-error-state-icon" aria-hidden="true">
        {IconGlyph({ name: "warning", size: 32, decorative: true })}
      </div>
      <p className="vma-error-state-title" data-vma-style-part="title">
        {props.title}
      </p>
      {props.description ? (
        <p
          className="vma-error-state-description"
          data-vma-style-part="description"
        >
          {props.description}
        </p>
      ) : null}
      <button
        type="button"
        className="vma-error-state-retry"
        onClick={() => on("retry").emit()}
      >
        {IconGlyph({ name: "refresh", size: 14, decorative: true })}
        {props.retryLabel ?? catalogMessage("common.retry")}
      </button>
    </div>
  );
}

/* ---------------- AlertDialog ---------------- */

export function AlertDialog({
  props,
  children,
}: BaseProps<{ openPath: string; defaultOpen?: boolean }>) {
  const [open, setOpen] = useStateBinding<boolean | undefined>(props.openPath);
  const isOpen = open ?? props.defaultOpen ?? false;
  return (
    <AlertDialogContext.Provider value={{ open: isOpen, setOpen }}>
      {children}
      {isOpen ? (
        <div
          className="vma-alert-dialog-overlay"
          data-vma-style-part="overlay"
          role="presentation"
        />
      ) : null}
    </AlertDialogContext.Provider>
  );
}

import { createContext, useContext, useMemo } from "react";

interface DialogOpenContextValue {
  open: boolean;
  setOpen: (value: boolean) => void;
}

const AlertDialogContext = createContext<DialogOpenContextValue | null>(null);

function useDialogOpen(): DialogOpenContextValue {
  const ctx = useContext(AlertDialogContext);
  // 结构 Gate 保证 Trigger/Content 只出现在合法父级内
  return ctx ?? { open: false, setOpen: () => undefined };
}

export function AlertDialogTrigger({
  children,
}: BaseProps<Record<string, never>>) {
  const { setOpen } = useDialogOpen();
  return (
    <button
      type="button"
      className="vma-alert-dialog-trigger"
      data-vma-style-part="root"
      aria-haspopup="dialog"
      onClick={() => setOpen(true)}
    >
      {children}
    </button>
  );
}

export function AlertDialogContent({
  props,
  children,
}: BaseProps<{ title: string; description?: string }>) {
  const { open, setOpen } = useDialogOpen();
  const labelledBy = useMemo(
    () => `vma-alert-title-${Math.abs(hashString(props.title))}`,
    [props.title],
  );
  if (!open) return null;
  return (
    <div
      className="vma-alert-dialog-content"
      data-vma-style-part="content"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <h2
        id={labelledBy}
        className="vma-alert-dialog-title"
        data-vma-style-part="title"
      >
        {props.title}
      </h2>
      {props.description ? (
        <p
          className="vma-alert-dialog-description"
          data-vma-style-part="description"
        >
          {props.description}
        </p>
      ) : null}
      {children}
      <button
        type="button"
        className="vma-alert-dialog-close"
        aria-label={catalogMessage("common.close")}
        onClick={() => setOpen(false)}
      >
        {IconGlyph({ name: "x", size: 16, decorative: true })}
      </button>
    </div>
  );
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash;
}

export function AlertDialogActions({
  children,
}: BaseProps<Record<string, never>>) {
  return (
    <div className="vma-alert-dialog-actions" data-vma-style-part="root">
      {children}
    </div>
  );
}

/* ---------------- Sheet ---------------- */

export function Sheet({
  props,
  children,
}: BaseProps<{
  openPath: string;
  defaultOpen?: boolean;
  side?: "left" | "right" | "bottom";
}>) {
  const [open, setOpen] = useStateBinding<boolean | undefined>(props.openPath);
  const isOpen = open ?? props.defaultOpen ?? false;
  const value = useMemo(() => ({ open: isOpen, setOpen }), [isOpen, setOpen]);
  return (
    <SheetContext.Provider value={value}>
      {children}
      {isOpen ? (
        <div
          className="vma-sheet-overlay"
          data-vma-style-part="overlay"
          role="presentation"
        />
      ) : null}
    </SheetContext.Provider>
  );
}

const SheetContext = createContext<DialogOpenContextValue | null>(null);

function useSheetOpen(): DialogOpenContextValue {
  const ctx = useContext(SheetContext);
  return ctx ?? { open: false, setOpen: () => undefined };
}

export function SheetTrigger({ children }: BaseProps<Record<string, never>>) {
  const { setOpen } = useSheetOpen();
  return (
    <button
      type="button"
      className="vma-sheet-trigger"
      data-vma-style-part="root"
      aria-haspopup="dialog"
      onClick={() => setOpen(true)}
    >
      {children}
    </button>
  );
}

export function SheetContent({
  props,
  children,
}: BaseProps<{ title?: string }>) {
  const { open, setOpen } = useSheetOpen();
  if (!open) return null;
  return (
    <div
      className="vma-sheet-content"
      data-vma-style-part="content"
      role="dialog"
      aria-modal="true"
      aria-label={props.title ?? catalogMessage("dialog.sidePanel")}
    >
      <div className="vma-sheet-header">
        {props.title ? (
          <h2 className="vma-sheet-title" data-vma-style-part="title">
            {props.title}
          </h2>
        ) : null}
        <button
          type="button"
          className="vma-sheet-close"
          aria-label={catalogMessage("dialog.closePanel")}
          onClick={() => setOpen(false)}
        >
          {IconGlyph({ name: "x", size: 16, decorative: true })}
        </button>
      </div>
      <div className="vma-sheet-body">{children}</div>
    </div>
  );
}

export function SheetFooter({ children }: BaseProps<Record<string, never>>) {
  return (
    <div className="vma-sheet-footer" data-vma-style-part="root">
      {children}
    </div>
  );
}
