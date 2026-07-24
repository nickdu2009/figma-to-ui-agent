import {
  lstat,
  mkdir,
  realpath,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { parseProjectId } from "./project-id.ts";
import { safeRelativePathSchema } from "./schemas.ts";

export class ProjectPathError extends Error {
  readonly code:
    | "path_escape"
    | "symlink_forbidden"
    | "invalid_path_type";

  constructor(
    code:
      | "path_escape"
      | "symlink_forbidden"
      | "invalid_path_type",
    message: string,
  ) {
    super(message);
    this.name = "ProjectPathError";
    this.code = code;
  }
}

export interface ProjectLayout {
  dataRoot: string;
  projectsRoot: string;
  projectRoot: string;
  projectFile: string;
  figmaRoot: string;
  figmaHistoryRoot: string;
  figmaAssetsRoot: string;
  figmaScreenshotsRoot: string;
  flowRoot: string;
  flowHistoryRoot: string;
  specsRoot: string;
  specsHistoryRoot: string;
  runsRoot: string;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function assertContained(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new ProjectPathError(
      "path_escape",
      `路径超出项目目录：${candidate}`,
    );
  }
}

export async function assertNotSymlink(
  path: string,
  expectedType?: "file" | "directory",
): Promise<void> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    throw error;
  }

  if (stats.isSymbolicLink()) {
    throw new ProjectPathError(
      "symlink_forbidden",
      `受管路径不能是符号链接：${path}`,
    );
  }
  if (
    (expectedType === "file" && !stats.isFile()) ||
    (expectedType === "directory" && !stats.isDirectory())
  ) {
    throw new ProjectPathError(
      "invalid_path_type",
      `受管路径类型不正确：${path}`,
    );
  }
}

async function ensureDirectory(path: string): Promise<void> {
  try {
    await mkdir(path);
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      )
    ) {
      throw error;
    }
  }
  await assertNotSymlink(path, "directory");
}

export async function ensureProjectLayout(
  dataRootInput: string,
  projectIdInput: unknown,
): Promise<ProjectLayout> {
  const projectId = parseProjectId(projectIdInput);
  const dataRoot = resolve(dataRootInput);

  await mkdir(dataRoot, { recursive: true });
  await assertNotSymlink(dataRoot, "directory");
  const canonicalDataRoot = await realpath(dataRoot);

  const projectsRoot = join(canonicalDataRoot, "projects");
  const projectRoot = join(projectsRoot, projectId);
  const figmaRoot = join(projectRoot, "figma");
  const figmaHistoryRoot = join(figmaRoot, "history");
  const figmaAssetsRoot = join(figmaRoot, "assets");
  const figmaScreenshotsRoot = join(figmaRoot, "screenshots");
  const flowRoot = join(projectRoot, "flow");
  const flowHistoryRoot = join(flowRoot, "history");
  const specsRoot = join(projectRoot, "specs");
  const specsHistoryRoot = join(specsRoot, "history");
  const runsRoot = join(projectRoot, "runs");

  for (const path of [
    projectsRoot,
    projectRoot,
    figmaRoot,
    figmaHistoryRoot,
    figmaAssetsRoot,
    figmaScreenshotsRoot,
    flowRoot,
    flowHistoryRoot,
    specsRoot,
    specsHistoryRoot,
    runsRoot,
  ]) {
    assertContained(canonicalDataRoot, path);
    await ensureDirectory(path);
    const canonicalPath = await realpath(path);
    assertContained(canonicalDataRoot, canonicalPath);
  }

  return {
    dataRoot: canonicalDataRoot,
    projectsRoot,
    projectRoot,
    projectFile: join(projectRoot, "project.json"),
    figmaRoot,
    figmaHistoryRoot,
    figmaAssetsRoot,
    figmaScreenshotsRoot,
    flowRoot,
    flowHistoryRoot,
    specsRoot,
    specsHistoryRoot,
    runsRoot,
  };
}

export function resolveProjectPath(
  layout: ProjectLayout,
  relativePathInput: unknown,
): string {
  const relativePath = safeRelativePathSchema.parse(relativePathInput);
  const candidate = resolve(layout.projectRoot, relativePath);
  assertContained(layout.projectRoot, candidate);
  return candidate;
}

export async function assertManagedFilePath(
  layout: ProjectLayout,
  path: string,
): Promise<void> {
  assertContained(layout.projectRoot, resolve(path));
  await assertNotSymlink(dirname(path), "directory");
  await assertNotSymlink(path, "file");
}
