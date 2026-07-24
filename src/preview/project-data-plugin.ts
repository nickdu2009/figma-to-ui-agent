import { readFile } from "node:fs/promises";

import type { Plugin } from "vite";
import { ZodError } from "zod";

import {
  assertManagedFilePath,
  ensureProjectLayout,
  ProjectPathError,
  resolveProjectPath,
} from "../project-store/path-safety.ts";
import { parseProjectId } from "../project-store/project-id.ts";
import {
  ProjectStore,
  ProjectStoreError,
} from "../project-store/store.ts";
import {
  runIdSchema,
  validationRecordSchema,
} from "../validation/schema.ts";

function sendJson(
  response: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body?: string | Uint8Array) => void;
  },
  status: number,
  value: unknown,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(`${JSON.stringify(value)}\n`);
}

function decodeRelativePath(value: string): string {
  try {
    return value
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    throw new Error("invalid_encoded_path");
  }
}

function optionalRevision(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  if (!/^[1-9][0-9]{0,8}$/.test(value)) {
    throw new Error("invalid_revision");
  }
  return Number(value);
}

function errorStatus(error: unknown): number {
  if (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    return 404;
  }
  if (
    error instanceof ProjectStoreError &&
    error.code === "not_found"
  ) {
    return 404;
  }
  if (
    error instanceof Error &&
    (error.message === "invalid_encoded_path" ||
      error.message === "invalid_revision")
  ) {
    return 400;
  }
  if (error instanceof ZodError || error instanceof ProjectPathError) {
    return 400;
  }
  return 500;
}

export function projectDataPlugin(dataRoot: string): Plugin {
  const store = new ProjectStore(dataRoot);
  return {
    name: "figma-to-ui-project-data",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(
          request.url ?? "/",
          "http://127.0.0.1",
        );
        const parts = requestUrl.pathname.split("/").filter(Boolean);
        if (
          parts.length < 4 ||
          parts[0] !== "api" ||
          parts[1] !== "projects"
        ) {
          next();
          return;
        }
        if (request.method !== "GET") {
          sendJson(response, 405, { code: "method_not_allowed" });
          return;
        }

        try {
          const projectId = parseProjectId(
            decodeURIComponent(parts[2]!),
          );
          const resource = parts[3]!;
          const revision = optionalRevision(
            requestUrl.searchParams.get("revision"),
          );
          if (resource === "design-bundle" && parts.length === 4) {
            sendJson(
              response,
              200,
              await store.loadDesignBundle(projectId, revision),
            );
            return;
          }
          if (resource === "ui-spec" && parts.length === 4) {
            sendJson(
              response,
              200,
              await store.loadUISpec(projectId, revision),
            );
            return;
          }

          const layout = await ensureProjectLayout(dataRoot, projectId);
          if (resource === "files" && parts.length > 4) {
            const relativePath = decodeRelativePath(
              parts.slice(4).join("/"),
            );
            const bundle = await store.loadDesignBundle(
              projectId,
              revision,
            );
            const image = [...bundle.assets, ...bundle.screenshots].find(
              (candidate) => candidate.path === relativePath,
            );
            if (!image) {
              sendJson(response, 404, {
                code: "image_not_registered",
              });
              return;
            }
            const absolutePath = resolveProjectPath(
              layout,
              image.path,
            );
            await assertManagedFilePath(layout, absolutePath);
            const bytes = await readFile(absolutePath);
            response.statusCode = 200;
            response.setHeader("Content-Type", image.mimeType);
            response.setHeader(
              "Content-Length",
              String(bytes.byteLength),
            );
            response.setHeader("Cache-Control", "no-store");
            response.setHeader("X-Content-Type-Options", "nosniff");
            response.end(bytes);
            return;
          }

          if (resource === "runs" && parts.length === 5) {
            const runId = runIdSchema.parse(parts[4]);
            const path = resolveProjectPath(
              layout,
              `runs/${runId}/validation.json`,
            );
            await assertManagedFilePath(layout, path);
            const record = validationRecordSchema.parse(
              JSON.parse(await readFile(path, "utf8")),
            );
            sendJson(response, 200, record);
            return;
          }

          if (resource === "run-files" && parts.length === 7) {
            const runId = runIdSchema.parse(parts[4]);
            const kind = parts[5];
            const filename = parts[6];
            if (
              (kind !== "screenshots" && kind !== "diffs") ||
              !/^[A-Za-z0-9._-]{1,256}$/.test(filename ?? "")
            ) {
              sendJson(response, 400, { code: "invalid_run_file" });
              return;
            }
            const recordPath = resolveProjectPath(
              layout,
              `runs/${runId}/validation.json`,
            );
            await assertManagedFilePath(layout, recordPath);
            const record = validationRecordSchema.parse(
              JSON.parse(await readFile(recordPath, "utf8")),
            );
            const relativePath = `runs/${runId}/${kind}/${filename}`;
            const registered = record.output.results.some(
              (result) =>
                result.expectedImage === relativePath ||
                result.actualImage === relativePath ||
                result.diffImage === relativePath,
            );
            if (!registered) {
              sendJson(response, 404, {
                code: "run_file_not_registered",
              });
              return;
            }
            const artifactPath = resolveProjectPath(
              layout,
              relativePath,
            );
            await assertManagedFilePath(layout, artifactPath);
            const bytes = await readFile(artifactPath);
            response.statusCode = 200;
            response.setHeader(
              "Content-Type",
              filename?.endsWith(".jpg") ||
                filename?.endsWith(".jpeg")
                ? "image/jpeg"
                : filename?.endsWith(".webp")
                  ? "image/webp"
                  : "image/png",
            );
            response.setHeader(
              "Content-Length",
              String(bytes.byteLength),
            );
            response.setHeader("Cache-Control", "no-store");
            response.setHeader("X-Content-Type-Options", "nosniff");
            response.end(bytes);
            return;
          }

          sendJson(response, 404, { code: "not_found" });
        } catch (error) {
          const status = errorStatus(error);
          sendJson(response, status, {
            code:
              status === 404
                ? "not_found"
                : status === 400
                  ? "invalid_request"
                  : "internal_error",
          });
        }
      });
    },
  };
}
