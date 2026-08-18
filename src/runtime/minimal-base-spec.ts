import type { NextAppSpec } from "@next-app-runtime/client";

/**
 * The smallest valid NextAppSpec: an empty application shell with metadata
 * only and no routes. It is used for two purposes only:
 *
 * - explicit reset: it is submitted through `runtime.applySource` so it
 *   becomes the new `current` (never returned as a fake `current`);
 * - empty-state fallback for `summarizeCurrentApp` when no current exists.
 */
export const minimalBaseSpec: NextAppSpec = {
  metadata: {
    title: {
      default: "Untitled App",
      template: "%s | Untitled App",
    },
  },
  routes: {},
};
