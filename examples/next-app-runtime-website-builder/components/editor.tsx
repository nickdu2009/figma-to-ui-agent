"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { JsonEditor, type JsonValue } from "@visual-json/react";
import {
  createNextAppRuntime,
  NextAppProvider,
  PageRenderer,
  type NextAppSpec,
} from "@next-app-runtime/client";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { AddressBar } from "@/components/route-tabs";
import { registry } from "@/lib/registry";
import { catalog } from "@/lib/catalog";
import { defaultSpec } from "@/lib/default-spec";
import {
  readSpec,
  subscribeSpec,
  validatePreviewSpecCandidate,
  WEBSITE_RUNTIME_LIMITS,
  writeSpec,
} from "@/lib/spec-store";

async function validateCandidateForPreview(candidate: unknown) {
  const runtime = createNextAppRuntime({
    catalog,
    registry,
    limits: WEBSITE_RUNTIME_LIMITS,
    fallbacks: {
      loading: () => null,
      error: () => null,
      notFound: () => null,
      unmatched: () => null,
    },
  });
  try {
    return await validatePreviewSpecCandidate(runtime, candidate);
  } finally {
    runtime.dispose();
  }
}

export function Editor() {
  const [candidate, setCandidate] = useState<JsonValue>(
    () => structuredClone(defaultSpec) as unknown as JsonValue,
  );
  const [previewSpec, setPreviewSpec] = useState<NextAppSpec>(
    () => structuredClone(defaultSpec),
  );
  const [activeRoute, setActiveRoute] = useState("/");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validationRevisionRef = useRef(0);

  useEffect(() => {
    const load = async () => {
      const revision = ++validationRevisionRef.current;
      const result = readSpec();
      if (result.ok) {
        setCandidate(result.spec as unknown as JsonValue);
        setWriteError(null);
        const validation = await validateCandidateForPreview(result.spec);
        if (revision !== validationRevisionRef.current) return;
        if (validation.ok) {
          setPreviewSpec(validation.spec);
          setCandidateError(null);
        } else {
          setCandidateError(validation.code);
        }
      } else if (result.code === "stored_spec_contract_invalid") {
        setCandidate(result.candidate as JsonValue);
        setCandidateError(result.code);
      } else {
        setCandidateError(result.code);
      }
    };
    void load();
    const unsubscribe = subscribeSpec(() => { void load(); });
    return () => {
      validationRevisionRef.current += 1;
      unsubscribe();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = useCallback((value: JsonValue) => {
    setCandidate(value);
    const revision = ++validationRevisionRef.current;
    void validateCandidateForPreview(value).then((validation) => {
      if (revision !== validationRevisionRef.current) return;
      if (validation.ok) {
        setPreviewSpec(validation.spec);
        setCandidateError(null);
      } else {
        setCandidateError(validation.code);
      }
    });

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const result = writeSpec(value);
      setWriteError(result.ok ? null : result.code);
    }, 500);
  }, []);

  const handlePreviewClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("mailto:")) return;
    e.preventDefault();
    setActiveRoute(href);
  }, []);

  const currentRoute = useMemo(() => {
    return previewSpec.routes[activeRoute] ?? null;
  }, [previewSpec, activeRoute]);

  const layoutSpec = useMemo(() => {
    if (!currentRoute?.layout || !previewSpec.layouts) return null;
    return previewSpec.layouts[currentRoute.layout] ?? null;
  }, [previewSpec, currentRoute]);

  const initialState = useMemo(() => {
    if (!currentRoute) return undefined;
    const merged: Record<string, unknown> = {};
    if (previewSpec.state) Object.assign(merged, previewSpec.state);
    if (currentRoute.page.state) Object.assign(merged, currentRoute.page.state);
    return Object.keys(merged).length > 0 ? merged : undefined;
  }, [previewSpec, currentRoute]);

  const storeError = writeError ?? candidateError;
  const storeErrorMessage = writeError
    ? "The latest change could not be stored. The stored candidate is unchanged."
    : candidateError === "stored_spec_parse_failed"
      ? "The stored candidate is invalid JSON. The stored value is unchanged."
      : candidateError === "stored_spec_read_failed"
        ? "The stored candidate could not be read. The last valid preview remains active."
        : candidateError === "source_limit_exceeded"
          ? "The stored candidate exceeds runtime limits. The last valid preview remains active."
        : "The stored candidate violates NextAppSpec 0.19.0. The last valid preview remains active.";

  return (
    <div className="h-screen flex flex-col">
      {storeError && (
        <div data-storage-error={storeError} className="px-4 py-2 text-xs text-destructive border-b">
          {storeErrorMessage}
        </div>
      )}
      <div className="flex items-center justify-between px-4 h-12 border-b border-border bg-background shrink-0">
        <span className="text-sm font-semibold">Next Website Builder</span>
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View Website
        </a>
      </div>
      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        <ResizablePanel defaultSize={45} minSize={25}>
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-3 h-10 border-b border-border bg-muted/30">
              <span className="text-xs font-mono text-muted-foreground">
                spec.json
              </span>
              <button
                onClick={() => setSidebarOpen((v) => !v)}
                className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 3v18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              <JsonEditor
                value={candidate}
                onChange={handleChange}
                sidebarOpen={sidebarOpen}
                height="100%"
                className="h-full"
                style={
                  {
                    "--vj-bg": "var(--background)",
                    "--vj-bg-panel": "var(--background)",
                    "--vj-bg-hover": "var(--muted)",
                    "--vj-bg-selected": "var(--primary)",
                    "--vj-bg-selected-muted": "var(--muted)",
                    "--vj-text": "var(--foreground)",
                    "--vj-text-selected": "var(--primary-foreground)",
                    "--vj-text-muted": "var(--muted-foreground)",
                    "--vj-text-dim": "var(--muted-foreground)",
                    "--vj-border": "var(--border)",
                    "--vj-border-subtle": "var(--border)",
                    "--vj-accent": "var(--primary)",
                    "--vj-accent-muted": "var(--muted)",
                    "--vj-input-bg": "var(--secondary)",
                    "--vj-input-border": "var(--border)",
                  } as React.CSSProperties
                }
              />
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={55} minSize={30}>
          <div className="h-full flex flex-col">
            <AddressBar route={activeRoute} onNavigate={setActiveRoute} />
            <div
              className="flex-1 overflow-auto bg-background"
              onClickCapture={handlePreviewClick}
            >
              {currentRoute ? (
                <NextAppProvider registry={registry}>
                  <PageRenderer
                    spec={currentRoute.page}
                    initialState={initialState}
                    layoutSpec={layoutSpec}
                  />
                </NextAppProvider>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Route not found
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
