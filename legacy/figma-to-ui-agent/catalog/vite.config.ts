import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

export default defineConfig({
  root: resolve(projectRoot, "catalog"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    fs: { allow: [projectRoot] },
  },
  build: {
    outDir: resolve(projectRoot, "catalog/dist"),
    emptyOutDir: true,
  },
});
