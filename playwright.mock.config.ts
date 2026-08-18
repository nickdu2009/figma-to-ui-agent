import { defineConfig } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath)
  throw new Error("PLAYWRIGHT_CHROMIUM_EXECUTABLE is required");

// 与 playwright.config.ts 相同的 Chromium/端口约束；差异仅在 Agent 模式与用例集。

/**
 * Mock 全链路浏览器验收（计划 §10 步骤 7）：
 * VMA_AGENT_MODE=mock，不调 LLM，走真实 AG-UI/CopilotKit 协议与
 * next-app-runtime applySource。
 */
export default defineConfig({
  testDir: "tests/browser",
  testMatch: ["agent-flow.spec.ts", "preview.spec.ts", "persistence.spec.ts"],
  fullyParallel: false,
  workers: 2,
  retries: 2,
  timeout: 60_000,
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
      command: "node server/index.ts",
      url: "http://127.0.0.1:3101/api/health",
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VMA_AGENT_MODE: "mock",
          ADMIN_EMAILS: "e2e-admin-0@example.com,e2e-admin-1@example.com,e2e-admin-2@example.com,e2e-admin-3@example.com,e2e-admin-4@example.com",
        VMA_SERVER_PORT: "3101",
        // 加宽流式窗口，让中止测试能在补丁流中途可靠点击停止。
        VMA_MOCK_PATCH_INTERVAL_MS: "300",
      },
    },
    {
      command: "vite --host 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100/",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
