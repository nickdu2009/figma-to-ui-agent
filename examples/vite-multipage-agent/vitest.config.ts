import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // 多个 DB 套件并行时，晚启动 worker 的 CREATE SCHEMA + 启动迁移会
    // 排队；实测单次 1–3s、满载可超 10s。给足余量并适度限流。
    hookTimeout: 30_000,
    testTimeout: 30_000,
    maxWorkers: 4,
  },
});
