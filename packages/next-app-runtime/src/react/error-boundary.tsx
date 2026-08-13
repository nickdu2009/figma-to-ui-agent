import React, { type ErrorInfo, type ReactNode } from "react";

import type { NextAppRuntime, RuntimeFallbacks } from "../contract/types.js";

interface RuntimeErrorBoundaryProps {
  runtime: NextAppRuntime;
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
  failedRevision: number | null;
  runtime: NextAppRuntime;
}

export class RuntimeErrorBoundary extends React.Component<
  RuntimeErrorBoundaryProps,
  RuntimeErrorBoundaryState
> {
  state: RuntimeErrorBoundaryState = {
    failed: false,
    failedRevision: null,
    runtime: this.props.runtime,
  };

  static getDerivedStateFromProps(
    props: RuntimeErrorBoundaryProps,
    state: RuntimeErrorBoundaryState,
  ): Partial<RuntimeErrorBoundaryState> | null {
    return props.runtime === state.runtime
      ? null
      : { failed: false, failedRevision: null, runtime: props.runtime };
  }

  static getDerivedStateFromError(): Partial<RuntimeErrorBoundaryState> {
    return { failed: true, failedRevision: null };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    const snapshot = this.props.runtime.getSnapshot();
    this.setState({ failedRevision: snapshot.revision });
    this.props.observer?.({
      name: "render_failed",
      at: Date.now(),
      revision: snapshot.revision,
      code: "render_failed",
    });
  }

  componentDidUpdate(): void {
    if (
      this.state.failed &&
      this.state.failedRevision !== null &&
      this.state.failedRevision !== this.props.runtime.getSnapshot().revision
    ) {
      this.setState({ failed: false, failedRevision: null });
    }
  }

  render() {
    if (this.state.failed) {
      const snapshot = this.props.runtime.getSnapshot();
      return this.props.fallback({ snapshot, status: "error" });
    }
    return this.props.children;
  }
}
