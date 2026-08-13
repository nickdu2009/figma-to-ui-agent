import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        schema: "src/schema.ts",
        router: "src/router.ts",
        stream: "src/stream.ts",
        testing: "src/testing.ts",
      },
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: [
        "@json-render/core",
        "@json-render/react",
        "react",
        "react/jsx-runtime",
        "zod",
      ],
    },
    sourcemap: true,
  },
});
