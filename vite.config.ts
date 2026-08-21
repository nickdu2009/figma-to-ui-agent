import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const serverPort = process.env.VMA_SERVER_PORT ?? "3101";

export default defineConfig({
  plugins: [react()],
  // 开发服务器直接编译 workspace 源码，不能依赖 packages/*/dist。
  // 后端重启、typecheck 或测试都会重建 next-app-runtime；其构建脚本会先
  // 清空 dist。若 Vite 正在消费 dist，这个短暂空窗会让 HMR 丢失 chunk，
  // 进而卸载当前 Preview。子路径必须排在包根路径之前，避免前缀抢配。
  resolve: {
    alias: [
      {
        find: "@next-app-runtime/client/schema",
        replacement: resolve(
          import.meta.dirname,
          "packages/next-app-runtime/src/schema.ts",
        ),
      },
      {
        find: "@next-app-runtime/client/router",
        replacement: resolve(
          import.meta.dirname,
          "packages/next-app-runtime/src/router.ts",
        ),
      },
      {
        find: "@next-app-runtime/client/stream",
        replacement: resolve(
          import.meta.dirname,
          "packages/next-app-runtime/src/stream.ts",
        ),
      },
      {
        find: "@next-app-runtime/client/testing",
        replacement: resolve(
          import.meta.dirname,
          "packages/next-app-runtime/src/testing.ts",
        ),
      },
      {
        find: "@next-app-runtime/client",
        replacement: resolve(
          import.meta.dirname,
          "packages/next-app-runtime/src/index.ts",
        ),
      },
    ],
  },
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
