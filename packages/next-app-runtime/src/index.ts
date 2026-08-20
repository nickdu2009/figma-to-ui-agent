export {
  createNextAppRuntime,
  createRuntimeWithNavigation,
} from "./runtime/create-runtime.js";
export type { NavigationDriver } from "./navigation/location.js";
export {
  NextAppProvider,
  NextAppRuntimeProvider,
  useNextApp,
  useNextAppNavigation,
  useNextAppRuntime,
  type NextAppContextValue,
  type NextAppProviderProps,
  type NextAppRuntimeProviderProps,
} from "./react/provider.js";
export { NextAppRenderer } from "./react/app-renderer.js";
export { PageRenderer, type PageRendererProps } from "./react/page-renderer.js";
export { Link, type LinkProps } from "./react/link.js";
export {
  NextErrorBoundary,
  NextLoading,
  NextNotFound,
  type NextErrorBoundaryProps,
  type NextLoadingProps,
} from "./react/compatibility.js";
export {
  RouteNotFound,
  RuntimeError,
  type ApplySourceOptions,
  type LoaderFn,
  type MatchedRoute,
  type NextAppRuntime,
  type NextAppSpec,
  type NextAppSpecSource,
  type NextMetadata,
  type NextRouteSpec,
  type PageData,
  type RouteStatus,
  type RuntimeErrorCode,
  type RuntimeEvent,
  type RuntimeEventName,
  type RuntimeFallbacks,
  type RuntimeLimits,
  type RuntimeLocation,
  type RuntimeOptions,
  type RuntimeSnapshot,
  type SourceResult,
  type SpecStatus,
} from "./contract/types.js";
export type { Spec, StateStore } from "@json-render/core";
export { createStateStore } from "@json-render/core";
// DS S3：custom Action 唯一执行边界（设计 §9.2）
export type {
  RuntimeActionAdapter,
  RuntimeActionContract,
  RuntimeActionDispatchResult,
  RuntimeActionDispatcher,
  RuntimeActionHandler,
  RuntimeActionIdentity,
  RuntimeActionPhase,
  RuntimeActionPermissionClass,
  RuntimeActionResult,
  RuntimeActionTargets,
  RuntimeHostEffects,
  RuntimePlatformUiDispatcher,
  RuntimeStaticCallback,
  StateStoreLike,
  ValidatedCustomActionInvocation,
} from "./actions/contracts.js";
export {
  decidePhaseAction,
  normalizeActionError,
} from "./actions/contracts.js";
export { ActionExecutionGate } from "./actions/execution-gate.js";
export { TargetLeaseTable } from "./actions/target-leases.js";
export { createRuntimeActionDispatcher } from "./actions/dispatcher.js";
export type {
  ActionFn,
  Actions,
  BaseComponentProps,
  ComponentContext,
  ComponentFn,
  ComponentRegistry,
  ComponentRenderProps,
  Components,
  EventHandle,
  SetState,
  StateModel,
} from "@json-render/react";
