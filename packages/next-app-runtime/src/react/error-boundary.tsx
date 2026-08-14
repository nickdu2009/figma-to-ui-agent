import React, { type ErrorInfo, type ReactNode } from "react";

import type { NextAppRuntime, RuntimeFallbacks } from "../contract/types.js";

interface RuntimeErrorBoundaryProps {
  runtime: NextAppRuntime;
  presentationIdentity: number;
  fallback: RuntimeFallbacks["error"];
  observer?: (event: {
    name: "render_failed";
    at: number;
    revision: number;
    code: "render_failed";
  }) => void;
  children: ReactNode;
}

interface RuntimeErrorBoundaryState {
  failed: boolean;
  presentationIdentity: number;
  runtime: NextAppRuntime;
}

export class RuntimeErrorBoundary extends React.Component<
  RuntimeErrorBoundaryProps,
  RuntimeErrorBoundaryState
> {
  state: RuntimeErrorBoundaryState = {
    failed: false,
    presentationIdentity: this.props.presentationIdentity,
    runtime: this.props.runtime,
  };

  static getDerivedStateFromProps(
    props: RuntimeErrorBoundaryProps,
    state: RuntimeErrorBoundaryState,
  ): Partial<RuntimeErrorBoundaryState> | null {
    if (
      props.runtime !== state.runtime ||
      props.presentationIdentity !== state.presentationIdentity
    ) {
      return {
        failed: false,
        presentationIdentity: props.presentationIdentity,
        runtime: props.runtime,
      };
    }
    return null;
  }

  static getDerivedStateFromError(): Partial<RuntimeErrorBoundaryState> {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    const snapshot = this.props.runtime.getSnapshot();
    this.props.observer?.({
      name: "render_failed",
      at: Date.now(),
      revision: snapshot.revision,
      code: "render_failed",
    });
  }

  render() {
    if (this.state.failed) {
      const snapshot = this.props.runtime.getSnapshot();
      return this.props.fallback({ snapshot, status: "error" });
    }
    return this.props.children;
  }
}
