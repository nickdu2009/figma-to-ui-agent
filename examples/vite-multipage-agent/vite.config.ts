import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const serverPort = process.env.VMA_SERVER_PORT ?? "3101";

export default defineConfig({
  plugins: [react()],
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
