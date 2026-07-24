import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import {
  createServer,
  type ViteDevServer,
} from "vite";

import { projectDataPlugin } from "./project-data-plugin.ts";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export interface PreviewServerOptions {
  dataRoot: string;
  port?: number;
}

export interface RunningPreviewServer {
  url: string;
  close: () => Promise<void>;
}

export async function startPreviewServer(
  options: PreviewServerOptions,
): Promise<RunningPreviewServer> {
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      configFile: false,
      root: resolve(projectRoot, "preview"),
      plugins: [react(), projectDataPlugin(options.dataRoot)],
      server: {
        host: "127.0.0.1",
        port: options.port ?? 0,
        strictPort: options.port !== undefined,
        fs: {
          allow: [projectRoot],
        },
      },
      appType: "spa",
      clearScreen: false,
      logLevel: "silent",
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") {
      throw new Error("Preview 服务器未返回 TCP 监听地址");
    }
    return {
      url: `http://127.0.0.1:${address.port}`,
      close: async () => {
        await server?.close();
      },
    };
  } catch (error) {
    await server?.close();
    throw error;
  }
}
