import { defineConfig } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath)
  throw new Error("PLAYWRIGHT_CHROMIUM_EXECUTABLE is required");

/**
 * DS-GATE-00 / DSG-04：2MiB finish 探针专用配置。
 * - 端口复用 dev 白名单 3100/3101（CSRF Origin 白名单约束；探针运行期独占，
 *   reuseExistingServer:false 保证不附着到用户在跑的实例）
 * - 服务端走 scripts/ds-gate-00/gate00-server.mjs 包装：
 *   probe Agent + 隔离 MySQL schema（自动创建/清理）+ RSS 峰值采样
 * - 不修改任何既有 playwright 配置或生产中间件（单写者约束）
 */
export default defineConfig({
  testDir: "tests/browser",
  testMatch: ["gate00-generation-finish.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    launchOptions: { executablePath },
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
  },
  webServer: [
    {
      command: "node scripts/ds-gate-00/gate00-server.mjs",
      url: "http://127.0.0.1:3101/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VMA_GATE00_SERVER_PORT: "3101" },
    },
    {
      command: "vite --host 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100/probe.html",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VMA_SERVER_PORT: "3101" },
    },
  ],
});
