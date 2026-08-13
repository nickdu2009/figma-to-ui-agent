import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "tests/browser/fixture",
  plugins: [react()],
  server: { strictPort: true },
});
