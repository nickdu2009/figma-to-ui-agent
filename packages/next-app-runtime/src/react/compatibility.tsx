import React from "react";
import type { Spec } from "@json-render/core";
import { Renderer, type ComponentRegistry } from "@json-render/react";

import { useNextApp } from "./provider.js";

export interface NextErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
  errorSpec?: Spec | null;
}

export function NextErrorBoundary({ error, reset, errorSpec }: NextErrorBoundaryProps) {
  let registry: ComponentRegistry | undefined;
  try {
    registry = useNextApp().registry;
  } catch {
    registry = undefined;
  }
  if (errorSpec && registry) {
    return <Renderer spec={errorSpec} registry={{ ...registry, Slot: () => null }} />;
  }

  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2 style={{ marginBottom: "1rem" }}>Something went wrong</h2>
      <p style={{ color: "#666", marginBottom: "1.5rem" }}>
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        onClick={reset}
        style={{
          padding: "0.5rem 1rem",
          borderRadius: "0.375rem",
          border: "1px solid #ccc",
          background: "#fff",
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}

export interface NextLoadingProps {
  loadingSpec?: Spec | null;
}

export function NextLoading({ loadingSpec: _loadingSpec }: NextLoadingProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "200px",
      }}
    >
      <div
        style={{
          width: "2rem",
          height: "2rem",
          border: "2px solid #e5e7eb",
          borderTopColor: "#3b82f6",
          borderRadius: "50%",
          animation: "jr-spin 0.6s linear infinite",
        }}
      />
      <style>{`@keyframes jr-spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

export function NextNotFound() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "400px",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "4rem", fontWeight: 700, margin: 0 }}>404</h1>
      <p style={{ color: "#666", marginTop: "0.5rem", fontSize: "1.125rem" }}>
        This page could not be found.
      </p>
    </div>
  );
}
