import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import {
  createPrototypeSafeStateStore,
  reconcileInitialState,
} from "./prototype-safe-state-store.js";
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
  return (
    <Renderer spec={layoutSpec} registry={layoutRegistry} loading={loading} />
  );
}

export function PageRenderer({
  spec,
  initialState,
  layoutSpec,
  loading,
}: PageRendererProps) {
  const { registry, handlers, actionDispatcher, navigate } = useNextApp();
  const actionObserverScope = useRuntimeActionObserverScope();
  const [stateStore] = useState(() =>
    createPrototypeSafeStateStore(initialState),
  );
  // DS S3：把页面 state store 注册为 Dispatcher 唯一写面；卸载即撤销写权限
  useEffect(() => {
    if (!actionDispatcher) return;
    actionDispatcher.setActiveStateStore(stateStore);
    return () => actionDispatcher.setActiveStateStore(null);
  }, [actionDispatcher, stateStore]);
  const previousInitialState = useRef(initialState);
  useEffect(() => {
    if (initialState === previousInitialState.current) return;
    reconcileInitialState(
      stateStore,
      previousInitialState.current ?? {},
      initialState ?? {},
    );
    previousInitialState.current = initialState;
  }, [initialState, stateStore]);
  const scopedRegistry = useMemo<ComponentRegistry>(
    () =>
      Object.fromEntries(
        Object.entries(registry).map(([name, Component]) => {
          const ScopedComponent = (props: ComponentRenderProps) => {
            const emit = (event: string) =>
              runWithRuntimeActionObserverScope(actionObserverScope, () =>
                props.emit(event),
              );
            const on = (event: string) => {
              const handle = props.on(event);
              return {
                ...handle,
                emit: () =>
                  runWithRuntimeActionObserverScope(
                    actionObserverScope,
                    handle.emit,
                  ),
              };
            };
            return <Component {...props} emit={emit} on={on} />;
          };
          ScopedComponent.displayName = `RuntimeScoped(${name})`;
          return [name, ScopedComponent];
        }),
      ),
    [actionObserverScope, registry],
  );
  const augmentedRegistry = useMemo<ComponentRegistry>(
    () => ({ ...scopedRegistry, Slot: SlotComponent, Link }),
    [scopedRegistry],
  );
  const actionHandlers = useMemo(() => {
    const result: Record<
      string,
      (params: Record<string, unknown>) => Promise<unknown> | unknown
    > = { ...(handlers ?? {}) };
    if (actionDispatcher) {
      // DS S3 分流：将 custom Action 分发给唯一 Dispatcher 执行并返回
      // settle 后的结果，由 Dispatcher 在终态后闭合回调与网关校验。
      for (const name of actionDispatcher.getAdapterActionNames()) {
        result[name] = async (params: Record<string, unknown>) => {
          return await actionDispatcher.dispatchCustomAction({
            actionName: name,
            params,
            identity: actionDispatcher.getExecutionIdentity(),
          });
        };
      }
    }
    result.navigate = (params: Record<string, unknown>) => {
      if (typeof params.href === "string") navigate(params.href);
    };
    return result;
  }, [actionDispatcher, handlers, navigate]);
  const content = (
    <Renderer spec={spec} registry={augmentedRegistry} loading={loading} />
  );
  return (
    <StateProvider store={stateStore}>
      <VisibilityProvider>
        <ValidationProvider>
          <ActionProvider handlers={actionHandlers} navigate={navigate}>
            {layoutSpec ? (
              <LayoutWithSlot
                layoutSpec={layoutSpec}
                registry={augmentedRegistry}
                loading={loading}
              >
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
