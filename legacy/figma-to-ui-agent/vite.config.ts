import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { projectDataPlugin } from "./src/preview/project-data-plugin.ts";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const dataRoot = resolve(
  projectRoot,
  process.env.FIGMA_UI_DATA_ROOT ?? "data",
);
const root = process.env.VITEST
  ? projectRoot
  : resolve(projectRoot, "preview");

export default defineConfig({
  root,
  plugins: [react(), projectDataPlugin(dataRoot)],
  server: {
    host: "127.0.0.1",
    fs: { allow: [projectRoot] },
  },
  build: {
    outDir: resolve(projectRoot, "data/preview-dist"),
    emptyOutDir: true,
  },
});
