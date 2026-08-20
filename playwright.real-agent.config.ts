import { defineConfig } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const reuseExistingServer = process.env.VMA_REAL_E2E_REUSE === "1";
if (!executablePath) {
  throw new Error("PLAYWRIGHT_CHROMIUM_EXECUTABLE is required");
}

/**
 * 真实模型单场景验收：必须经 direnv 注入服务器凭据后单独运行。
 * gate00-server 创建、迁移并清理 vma_gate00_<hex> 隔离 schema；不触碰默认开发库。
 */
export default defineConfig({
  testDir: "tests/browser",
  testMatch: "real-agent-e2e.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    launchOptions: { executablePath },
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    colorScheme: "light",
  },
  webServer: [
    {
      command: "node scripts/ds-gate-00/gate00-server.mjs",
      url: "http://127.0.0.1:3101/api/health",
      reuseExistingServer,
      timeout: 45_000,
      env: {
        VMA_GATE00_AGENT_MODE: "openai",
        VMA_GATE00_SERVER_PORT: "3101",
        ADMIN_EMAILS: "real-agent-e2e@example.com",
      },
    },
    {
      command: "vite --host 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100/",
      reuseExistingServer,
      timeout: 45_000,
    },
  ],
});
