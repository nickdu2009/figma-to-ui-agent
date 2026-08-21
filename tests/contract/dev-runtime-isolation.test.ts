import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "vite";

describe("开发服务器与 runtime 构建产物隔离", () => {
  it("Vite 从 workspace 源码解析 next-app-runtime，后端重启不会读取 dist 空窗", async () => {
    const config = await resolveConfig(
      { configFile: resolve("vite.config.ts") },
      "serve",
    );
    const runtimeAliases = config.resolve.alias.filter(
      (entry) =>
        typeof entry.find === "string" &&
        entry.find.startsWith("@next-app-runtime/client"),
    );

    expect(runtimeAliases.map((entry) => entry.find)).toEqual([
      "@next-app-runtime/client/schema",
      "@next-app-runtime/client/router",
      "@next-app-runtime/client/stream",
      "@next-app-runtime/client/testing",
      "@next-app-runtime/client",
    ]);
    expect(runtimeAliases.map((entry) => entry.replacement)).toEqual([
      resolve("packages/next-app-runtime/src/schema.ts"),
      resolve("packages/next-app-runtime/src/router.ts"),
      resolve("packages/next-app-runtime/src/stream.ts"),
      resolve("packages/next-app-runtime/src/testing.ts"),
      resolve("packages/next-app-runtime/src/index.ts"),
    ]);
  });

  it("后端仍在启动前建立完整 runtime 产物", async () => {
    const packageJson = (await import("../../package.json", {
      with: { type: "json" },
    })) as { default: { scripts: Record<string, string> } };
    const scripts = packageJson.default.scripts;

    expect(scripts["predev:server"]).toBe("npm run build:runtime");
    expect(scripts["dev:server"]).toBe("node server/index.ts");
    expect(scripts["predev:server:mock"]).toBe("npm run build:runtime");
    expect(scripts["dev:server:mock"]).toBe(
      "VMA_AGENT_MODE=mock node server/index.ts",
    );
    expect(scripts["predev:server:probe"]).toBe("npm run build:runtime");
    expect(scripts["dev:server:probe"]).toBe(
      "VMA_AGENT_MODE=probe node server/index.ts",
    );
  });
});
