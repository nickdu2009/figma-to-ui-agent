import React, { useMemo, type ReactNode } from "react";
import type { Spec } from "@json-render/core";
import {
  ActionProvider,
  Renderer,
  StateProvider,
  ValidationProvider,
  VisibilityProvider,
  type ComponentRegistry,
  type ComponentRenderProps,
} from "@json-render/react";

import { useNextApp } from "./provider.js";
import { Link } from "./link.js";
import { runWithRuntimeActionObserverScope } from "./action-observer-manager.js";
import { useRuntimeActionObserverScope } from "./action-observer-scope.js";

export interface PageRendererProps {
  spec: Spec;
  initialState?: Record<string, unknown>;
  layoutSpec?: Spec | null;
  loading?: boolean;
}

function SlotComponent({ children }: ComponentRenderProps) {
  return <>{children}</>;
}

function LayoutWithSlot({
  layoutSpec,
  registry,
  loading,
  children,
}: {
  layoutSpec: Spec;
  registry: ComponentRegistry;
  loading?: boolean;
  children: ReactNode;
}) {
  const layoutRegistry = useMemo<ComponentRegistry>(
    () => ({ ...registry, Slot: () => <>{children}</> }),
    [registry, children],
  );
  return <Renderer spec={layoutSpec} registry={layoutRegistry} loading={loading} />;
}

export function PageRenderer({ spec, initialState, layoutSpec, loading }: PageRendererProps) {
  const { registry, handlers, navigate } = useNextApp();
  const actionObserverScope = useRuntimeActionObserverScope();
  const scopedRegistry = useMemo<ComponentRegistry>(() => Object.fromEntries(
    Object.entries(registry).map(([name, Component]) => {
      const ScopedComponent = (props: ComponentRenderProps) => {
        const emit = (event: string) => runWithRuntimeActionObserverScope(
          actionObserverScope,
          () => props.emit(event),
        );
        const on = (event: string) => {
          const handle = props.on(event);
          return {
            ...handle,
            emit: () => runWithRuntimeActionObserverScope(actionObserverScope, handle.emit),
          };
        };
        return <Component {...props} emit={emit} on={on} />;
      };
      ScopedComponent.displayName = `RuntimeScoped(${name})`;
      return [name, ScopedComponent];
    }),
  ), [actionObserverScope, registry]);
  const augmentedRegistry = useMemo<ComponentRegistry>(
    () => ({ ...scopedRegistry, Slot: SlotComponent, Link }),
    [scopedRegistry],
  );
  const actionHandlers = useMemo(() => {
    const result = { ...(handlers ?? {}) };
    result.navigate = (params: Record<string, unknown>) => {
      if (typeof params.href === "string") navigate(params.href);
    };
    return result;
  }, [handlers, navigate]);
  const content = <Renderer spec={spec} registry={augmentedRegistry} loading={loading} />;
  return (
    <StateProvider initialState={initialState}>
      <VisibilityProvider>
        <ValidationProvider>
          <ActionProvider handlers={actionHandlers} navigate={navigate}>
            {layoutSpec ? (
              <LayoutWithSlot layoutSpec={layoutSpec} registry={augmentedRegistry} loading={loading}>
                {content}
              </LayoutWithSlot>
            ) : (
              content
            )}
          </ActionProvider>
        </ValidationProvider>
      </VisibilityProvider>
    </StateProvider>
  );
}
