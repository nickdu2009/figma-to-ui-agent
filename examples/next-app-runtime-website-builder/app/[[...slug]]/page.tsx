import { useEffect, useState, useSyncExternalStore } from "react";
import {
  createNextAppRuntime,
  type RuntimeSnapshot,
} from "@next-app-runtime/client";
import { resolveMetadata } from "@next-app-runtime/client/router";

import { catalog } from "@/lib/catalog";
import { defaultSpec } from "@/lib/default-spec";
import { registry } from "@/lib/registry";
import {
  readSpec,
  subscribeSpec,
  WEBSITE_RUNTIME_LIMITS,
} from "@/lib/spec-store";
import { WebsiteRenderer } from "./renderer";

export interface WebsiteMetadataOwnership {
  description: boolean;
  icons: boolean;
}

function metadataOwnership(snapshot: RuntimeSnapshot): WebsiteMetadataOwnership {
  const spec = snapshot.routeSource === "candidate"
    ? snapshot.candidate
    : snapshot.current;
  const metadata = spec
    ? resolveMetadata(spec, snapshot.matched?.route ?? null)
    : {};
  return {
    description: Object.hasOwn(metadata, "description"),
    icons: Object.hasOwn(metadata, "icons"),
  };
}

export function WebsitePage({
  onMetadataOwnershipChange,
}: {
  onMetadataOwnershipChange: (ownership: WebsiteMetadataOwnership) => void;
}) {
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
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const ownership = metadataOwnership(snapshot);

  useEffect(() => {
    onMetadataOwnershipChange(ownership);
  }, [onMetadataOwnershipChange, ownership.description, ownership.icons]);

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
