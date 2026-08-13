import { useEffect, useState } from "react";
import { createNextAppRuntime } from "@next-app-runtime/client";

import { catalog } from "@/lib/catalog";
import { defaultSpec } from "@/lib/default-spec";
import { registry } from "@/lib/registry";
import {
  readSpec,
  subscribeSpec,
  WEBSITE_RUNTIME_LIMITS,
} from "@/lib/spec-store";
import { WebsiteRenderer } from "./renderer";

export function WebsitePage() {
  const [storageError, setStorageError] = useState<string | null>(null);
  const [runtime] = useState(() => createNextAppRuntime({
    initialSource: { kind: "object", value: defaultSpec },
    catalog,
    registry,
    limits: WEBSITE_RUNTIME_LIMITS,
    fallbacks: {
      loading: () => (
        <div className="flex items-center justify-center min-h-48 text-muted-foreground">
          Loading...
        </div>
      ),
      error: () => (
        <div className="flex items-center justify-center min-h-48 text-destructive">
          The website spec could not be rendered.
        </div>
      ),
      notFound: () => (
        <div className="flex items-center justify-center min-h-48 text-muted-foreground">
          Route not found
        </div>
      ),
      unmatched: () => (
        <div className="flex items-center justify-center min-h-48 text-muted-foreground">
          Route not found
        </div>
      ),
    },
  }));

  useEffect(() => {
    let applyRevision = 0;
    const apply = async () => {
      const revision = ++applyRevision;
      const result = readSpec();
      if (!result.ok) {
        if (revision === applyRevision) setStorageError(result.code);
        return;
      }
      const applied = await runtime.applySource({ kind: "object", value: result.spec });
      if (revision !== applyRevision) return;
      setStorageError(applied.status === "rejected" ? applied.error.code : null);
    };
    void apply();
    const unsubscribe = subscribeSpec(() => { void apply(); });
    return () => {
      applyRevision += 1;
      unsubscribe();
      runtime.dispose();
    };
  }, [runtime]);

  return (
    <>
      {storageError && (
        <div data-storage-error={storageError} className="p-3 text-sm text-destructive border-b">
          Stored spec is invalid. The last valid website remains active.
        </div>
      )}
      <WebsiteRenderer runtime={runtime} />
    </>
  );
}
