import { defineConfig } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath) {
  throw new Error("PLAYWRIGHT_CHROMIUM_EXECUTABLE is required");
}
if (!process.env.VMA_SPEC_BENCHMARK_REVIEW) {
  throw new Error("VMA_SPEC_BENCHMARK_REVIEW must point to a benchmark .review.json file");
}

export default defineConfig({
  testDir: "tests/browser",
  testMatch: ["spec-benchmark-candidate.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:3110",
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
      url: "http://127.0.0.1:3111/api/health",
      reuseExistingServer: false,
      timeout: 30_000,
      env: { VMA_AGENT_MODE: "mock", VMA_SERVER_PORT: "3111" },
    },
    {
      command: "vite --host 127.0.0.1 --port 3110",
      url: "http://127.0.0.1:3110/",
      reuseExistingServer: false,
      timeout: 30_000,
      env: { VITE_SPEC_BENCHMARK: "1", VMA_SERVER_PORT: "3111" },
    },
  ],
});
