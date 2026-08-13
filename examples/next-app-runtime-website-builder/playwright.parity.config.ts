import { defineConfig } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const oracleUrl = process.env.JSON_RENDER_ORACLE_URL;
const candidateUrl = process.env.NEXT_APP_RUNTIME_CANDIDATE_URL;

if (!executablePath) throw new Error("PLAYWRIGHT_CHROMIUM_EXECUTABLE is required");
if (!oracleUrl) throw new Error("JSON_RENDER_ORACLE_URL is required");
if (!candidateUrl) throw new Error("NEXT_APP_RUNTIME_CANDIDATE_URL is required");

export default defineConfig({
  testDir: "tests/parity",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    browserName: "chromium",
    launchOptions: { executablePath },
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
  },
});
