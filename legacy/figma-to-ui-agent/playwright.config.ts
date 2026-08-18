import { defineConfig } from "@playwright/test";

const probeCase = process.env.M0_PLAYWRIGHT_CASE ?? "default";

export default defineConfig({
  testDir: "./tests/probes",
  testMatch: "**/playwright-diff.spec.ts",
  outputDir:
    process.env.M0_PLAYWRIGHT_OUTPUT_DIR ??
    `./data/probes/playwright/${probeCase}/test-results`,
  snapshotPathTemplate: `./data/probes/playwright/${probeCase}/snapshots/{projectName}/{testFilePath}/{arg}{ext}`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        headless: true,
        viewport: { width: 320, height: 240 },
        deviceScaleFactor: 1,
        colorScheme: "light",
        reducedMotion: "reduce",
      },
    },
  ],
});
