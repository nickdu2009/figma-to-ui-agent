import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const serverPort = process.env.VMA_SERVER_PORT ?? "3101";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        probe: resolve(import.meta.dirname, "probe.html"),
        // S9：__validation 独立多页入口（不挂载 BrowserShell/聊天/正常 Preview）
        validation: resolve(import.meta.dirname, "__validation/index.html"),
      },
    },
  },
  server: {
    port: 3100,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
        // SSE 必须不缓冲：禁用压缩，保持逐块转发。
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("accept-encoding", "identity");
          });
        },
      },
    },
  },
});
