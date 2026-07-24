import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  type DesignBundle,
  type LocalImageRef,
  designBundleDraftSchema,
  designBundleSchema,
  localImageRefSchema,
} from "../design-bundle/schema.ts";
import {
  type FlowPlan,
  type FlowPlanDraft,
  flowPlanDraftSchema,
  flowPlanSchema,
} from "../flow-plan/schema.ts";
import { inspectImageBytes } from "../media/image-format.ts";
import {
  type UISpec,
  type UISpecDraft,
  type UINode,
  uiSpecDraftSchema,
  uiSpecSchema,
} from "../ui-spec/schema.ts";
import {
  assertManagedFilePath,
  assertNotSymlink,
  ensureProjectLayout,
  type ProjectLayout,
  ProjectPathError,
} from "./path-safety.ts";
import { parseProjectId } from "./project-id.ts";
import {
  type ProjectMetadata,
  projectMetadataSchema,
  SCHEMA_VERSION,
} from "./schemas.ts";

export type ProjectStoreErrorCode =
  | "not_found"
  | "invalid_input"
  | "revision_conflict"
  | "immutable_history_conflict"
  | "invalid_stored_data"
  | "cross_reference_invalid"
  | "store_busy";

export class ProjectStoreError extends Error {
  readonly code: ProjectStoreErrorCode;

  constructor(
    code: ProjectStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProjectStoreError";
    this.code = code;
  }
}

interface ArtifactPaths {
  current: string;
  historyRoot: string;
}

interface SaveArtifactInput<TDraft> {
  projectId: string;
  baseRevision: number;
  draft: TDraft;
}

interface SaveArtifactOptions<TDraft, TStored extends { revision: number }> {
  draftSchema: z.ZodType<TDraft>;
  storedSchema: z.ZodType<TStored>;
  getPaths: (layout: ProjectLayout) => ArtifactPaths;
  validateWithinLock?: (
    layout: ProjectLayout,
    draft: TDraft,
  ) => Promise<void>;
}

interface LockOwner {
  pid: number;
  token: string;
  createdAt: string;
}

const LOCK_WAIT_MS = 20;
const LOCK_TIMEOUT_MS = 5_000;
const INCOMPLETE_LOCK_GRACE_MS = 30_000;

function nodeErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error) {
    return String(error.code);
  }
  return undefined;
}

function assertBaseRevision(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ProjectStoreError(
      "revision_conflict",
      "baseRevision 必须是非负整数",
    );
  }
}

function isFigmaScreenshotPath(value: string): boolean {
  return /^figma\/screenshots\//.test(value);
}

function childIdsForNode(node: UINode | undefined): string[] {
  if (!node) {
    return [];
  }
  if ("childIds" in node) {
    return node.childIds;
  }
  if (node.kind === "tabs") {
    return node.tabs.flatMap((tab) => tab.childIds);
  }
  return [];
}

type ScreenshotFallbackNode = Extract<
  UINode,
  { kind: "image" | "pixel_overlay" }
>;

function rootScreenshotImage(
  rootNode: UINode | undefined,
  nodeById: ReadonlyMap<string, UINode>,
): ScreenshotFallbackNode | undefined {
  if (
    (rootNode?.kind === "image" || rootNode?.kind === "pixel_overlay") &&
    isFigmaScreenshotPath(rootNode.assetRef)
  ) {
    return rootNode;
  }
  const childIds = childIdsForNode(rootNode);
  if (childIds.length !== 1) {
    return undefined;
  }
  const onlyChild = nodeById.get(childIds[0]!);
  return (onlyChild?.kind === "image" ||
    onlyChild?.kind === "pixel_overlay") &&
    isFigmaScreenshotPath(onlyChild.assetRef)
    ? onlyChild
    : undefined;
}

function imageRefsForUINode(node: UINode): string[] {
  const refs: string[] = [];
  if (
    node.kind === "image" ||
    node.kind === "pixel_overlay" ||
    node.kind === "icon" ||
    node.kind === "avatar"
  ) {
    if ("assetRef" in node && node.assetRef) {
      refs.push(node.assetRef);
    }
  }
  if (node.kind === "button") {
    if (node.leadingIconAssetRef) {
      refs.push(node.leadingIconAssetRef);
    }
    if (node.trailingIconAssetRef) {
      refs.push(node.trailingIconAssetRef);
    }
  }
  return refs;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeSyncedTemporaryFile(
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    if (typeof content === "string") {
      await handle.writeFile(content, "utf8");
    } else {
      await handle.writeFile(content);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishImmutableFile(
  destination: string,
  content: string | Uint8Array,
): Promise<"created" | "exists"> {
  const directory = dirname(destination);
  const temporary = join(
    directory,
    `.${basename(destination)}.${randomUUID()}.tmp`,
  );
  try {
    await writeSyncedTemporaryFile(temporary, content);
    try {
      await link(temporary, destination);
    } catch (error) {
      if (nodeErrorCode(error) === "EEXIST") {
        return "exists";
      }
      throw error;
    }
    await syncDirectory(directory);
    return "created";
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (nodeErrorCode(error) !== "ENOENT") {
        throw error;
      }
    });
  }
}

async function publishImmutableJson(
  destination: string,
  content: string,
): Promise<"created" | "exists"> {
  return await publishImmutableFile(destination, content);
}

async function publishCurrentJson(
  destination: string,
  content: string,
): Promise<void> {
  const directory = dirname(destination);
  const temporary = join(
    directory,
    `.${basename(destination)}.${randomUUID()}.tmp`,
  );
  try {
    await writeSyncedTemporaryFile(temporary, content);
    await rename(temporary, destination);
    await syncDirectory(directory);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (nodeErrorCode(error) !== "ENOENT") {
        throw error;
      }
    });
  }
}

async function readValidatedJson<T>(
  layout: ProjectLayout,
  path: string,
  schema: z.ZodType<T>,
  allowMissing: boolean,
): Promise<T | undefined> {
  try {
    await assertManagedFilePath(layout, path);
    const raw = await readFile(path, "utf8");
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") {
      if (allowMissing) {
        return undefined;
      }
      throw new ProjectStoreError(
        "not_found",
        `项目数据不存在：${path}`,
        { cause: error },
      );
    }
    if (error instanceof ProjectPathError) {
      throw error;
    }
    throw new ProjectStoreError(
      "invalid_stored_data",
      `无法读取有效项目数据：${path}`,
      { cause: error },
    );
  }
}

async function cleanupTemporaryFiles(directory: string): Promise<void> {
  const entries = await readdir(directory);
  for (const entry of entries) {
    if (
      !/^\.(?:(?:project|current|\d+)\.json|[a-f0-9]{64}\.(?:png|jpg|webp))\.[a-f0-9-]+\.tmp$/.test(
        entry,
      )
    ) {
      continue;
    }
    const path = join(directory, entry);
    await assertNotSymlink(path, "file");
    await unlink(path);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return nodeErrorCode(error) !== "ESRCH";
  }
}

async function isLockAbandoned(lockPath: string): Promise<boolean> {
  await assertNotSymlink(lockPath, "directory");
  const ownerPath = join(lockPath, "owner.json");
  try {
    await assertNotSymlink(ownerPath, "file");
    const owner = JSON.parse(await readFile(ownerPath, "utf8")) as Partial<
      LockOwner
    >;
    if (
      typeof owner.pid === "number" &&
      Number.isInteger(owner.pid) &&
      owner.pid > 0 &&
      !isProcessAlive(owner.pid)
    ) {
      return true;
    }
    return false;
  } catch (error) {
    const errorCode = nodeErrorCode(error);
    if (errorCode && errorCode !== "ENOENT") {
      return false;
    }
    try {
      const stats = await lstat(lockPath);
      return Date.now() - stats.mtimeMs > INCOMPLETE_LOCK_GRACE_MS;
    } catch (statError) {
      if (nodeErrorCode(statError) === "ENOENT") {
        return true;
      }
      throw statError;
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function reclaimAbandonedLock(lockPath: string): Promise<boolean> {
  if (!(await pathExists(lockPath))) {
    return true;
  }
  if (!(await isLockAbandoned(lockPath))) {
    return false;
  }

  const recoveryLockPath = `${lockPath}.recovery`;
  try {
    await mkdir(recoveryLockPath);
  } catch (error) {
    if (nodeErrorCode(error) === "EEXIST") {
      return false;
    }
    throw error;
  }

  try {
    if (!(await pathExists(lockPath))) {
      return true;
    }
    if (!(await isLockAbandoned(lockPath))) {
      return false;
    }
    await rm(lockPath, { recursive: true, force: true });
    return true;
  } finally {
    await rm(recoveryLockPath, { recursive: true, force: true });
  }
}

async function acquireProjectLock(
  layout: ProjectLayout,
): Promise<() => Promise<void>> {
  const lockPath = join(layout.projectRoot, ".store-lock");
  const recoveryLockPath = `${lockPath}.recovery`;
  const owner: LockOwner = {
    pid: process.pid,
    token: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const startedAt = Date.now();

  while (Date.now() - startedAt < LOCK_TIMEOUT_MS) {
    if (await pathExists(recoveryLockPath)) {
      await assertNotSymlink(recoveryLockPath, "directory");
      await delay(LOCK_WAIT_MS);
      continue;
    }
    try {
      await mkdir(lockPath);
      await writeFile(
        join(lockPath, "owner.json"),
        `${JSON.stringify(owner, null, 2)}\n`,
        {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        },
      );
      return async () => {
        await rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (nodeErrorCode(error) !== "EEXIST") {
        await rm(lockPath, { recursive: true }).catch(() => undefined);
        throw error;
      }
      if (await reclaimAbandonedLock(lockPath)) {
        continue;
      }
      await delay(LOCK_WAIT_MS);
    }
  }

  throw new ProjectStoreError(
    "store_busy",
    `项目存储写锁超时：${layout.projectRoot}`,
  );
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export class ProjectStore {
  readonly dataRoot: string;

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot;
  }

  async initializeProject(projectIdInput: unknown): Promise<ProjectMetadata> {
    const projectId = parseProjectId(projectIdInput);
    const layout = await ensureProjectLayout(this.dataRoot, projectId);
    const release = await acquireProjectLock(layout);
    try {
      await cleanupTemporaryFiles(layout.projectRoot);
      return await this.ensureProjectMetadata(layout, projectId);
    } finally {
      await release();
    }
  }

  async saveDesignBundle(input: {
    projectId: string;
    baseRevision: number;
    draft: unknown;
  }): Promise<DesignBundle> {
    return await this.saveArtifact(input, {
      draftSchema: designBundleDraftSchema,
      storedSchema: designBundleSchema,
      getPaths: (layout) => ({
        current: join(layout.figmaRoot, "current.json"),
        historyRoot: layout.figmaHistoryRoot,
      }),
    });
  }

  async loadDesignBundle(
    projectIdInput: unknown,
    revision?: number,
  ): Promise<DesignBundle> {
    return await this.loadArtifact(
      projectIdInput,
      revision,
      designBundleSchema,
      (layout) => ({
        current: join(layout.figmaRoot, "current.json"),
        historyRoot: layout.figmaHistoryRoot,
      }),
    );
  }

  async saveFlowPlan(input: {
    projectId: string;
    baseRevision: number;
    draft: unknown;
  }): Promise<FlowPlan> {
    return await this.saveArtifact(input, {
      draftSchema: flowPlanDraftSchema,
      storedSchema: flowPlanSchema,
      getPaths: (layout) => ({
        current: join(layout.flowRoot, "current.json"),
        historyRoot: layout.flowHistoryRoot,
      }),
      validateWithinLock: async (layout, draft) => {
        await this.validateFlowPlanReferences(layout, draft);
      },
    });
  }

  async loadFlowPlan(
    projectIdInput: unknown,
    revision?: number,
  ): Promise<FlowPlan> {
    return await this.loadArtifact(
      projectIdInput,
      revision,
      flowPlanSchema,
      (layout) => ({
        current: join(layout.flowRoot, "current.json"),
        historyRoot: layout.flowHistoryRoot,
      }),
    );
  }

  async saveUISpec(input: {
    projectId: string;
    baseRevision: number;
    draft: unknown;
  }): Promise<UISpec> {
    return await this.saveArtifact(input, {
      draftSchema: uiSpecDraftSchema,
      storedSchema: uiSpecSchema,
      getPaths: (layout) => ({
        current: join(layout.specsRoot, "current.json"),
        historyRoot: layout.specsHistoryRoot,
      }),
      validateWithinLock: async (layout, draft) => {
        await this.validateUISpecAgainstDesignBundle(layout, draft);
      },
    });
  }

  async loadUISpec(
    projectIdInput: unknown,
    revision?: number,
  ): Promise<UISpec> {
    return await this.loadArtifact(
      projectIdInput,
      revision,
      uiSpecSchema,
      (layout) => ({
        current: join(layout.specsRoot, "current.json"),
        historyRoot: layout.specsHistoryRoot,
      }),
    );
  }

  async saveLocalImage(input: {
    projectId: string;
    kind: "assets" | "screenshots";
    bytes: Uint8Array;
  }): Promise<LocalImageRef> {
    const projectId = parseProjectId(input.projectId);
    if (
      input.bytes.byteLength < 1 ||
      input.bytes.byteLength > 100 * 1024 * 1024
    ) {
      throw new ProjectStoreError(
        "invalid_input",
        "图片字节数无效或超过上限",
      );
    }
    let inspected;
    try {
      inspected = inspectImageBytes(input.bytes);
    } catch {
      throw new ProjectStoreError(
        "invalid_input",
        "图片格式或尺寸无效",
      );
    }
    const sha256 = createHash("sha256")
      .update(input.bytes)
      .digest("hex");
    const relativePath =
      `figma/${input.kind}/${sha256}.${inspected.extension}`;
    const imageRef = localImageRefSchema.parse({
      path: relativePath,
      sha256,
      byteCount: input.bytes.byteLength,
      mimeType: inspected.mimeType,
      width: inspected.width,
      height: inspected.height,
    });

    const layout = await ensureProjectLayout(this.dataRoot, projectId);
    const imageRoot =
      input.kind === "assets"
        ? layout.figmaAssetsRoot
        : layout.figmaScreenshotsRoot;
    const destination = join(
      imageRoot,
      `${sha256}.${inspected.extension}`,
    );
    const release = await acquireProjectLock(layout);
    try {
      await cleanupTemporaryFiles(layout.projectRoot);
      await cleanupTemporaryFiles(imageRoot);
      await this.ensureProjectMetadata(layout, projectId);
      let existing: Uint8Array | undefined;
      try {
        await assertManagedFilePath(layout, destination);
        existing = await readFile(destination);
      } catch (error) {
        if (nodeErrorCode(error) !== "ENOENT") {
          throw error;
        }
      }
      if (existing) {
        const existingHash = createHash("sha256")
          .update(existing)
          .digest("hex");
        if (existingHash !== sha256) {
          throw new ProjectStoreError(
            "invalid_stored_data",
            "内容寻址图片与文件名哈希不一致",
          );
        }
        return imageRef;
      }

      const result = await publishImmutableFile(
        destination,
        input.bytes,
      );
      if (result === "exists") {
        await assertManagedFilePath(layout, destination);
        const raced = await readFile(destination);
        const racedHash = createHash("sha256")
          .update(raced)
          .digest("hex");
        if (racedHash !== sha256) {
          throw new ProjectStoreError(
            "invalid_stored_data",
            "并发发布的图片哈希不一致",
          );
        }
      }
      return imageRef;
    } finally {
      await release();
    }
  }

  private async ensureProjectMetadata(
    layout: ProjectLayout,
    projectId: string,
  ): Promise<ProjectMetadata> {
    const existing = await readValidatedJson(
      layout,
      layout.projectFile,
      projectMetadataSchema,
      true,
    );
    if (existing) {
      if (existing.projectId !== projectId) {
        throw new ProjectStoreError(
          "invalid_stored_data",
          "project.json 的项目标识与目录不一致",
        );
      }
      return existing;
    }

    const metadata = projectMetadataSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      projectId,
      createdAt: new Date().toISOString(),
    });
    const result = await publishImmutableJson(
      layout.projectFile,
      serialize(metadata),
    );
    if (result === "exists") {
      const raced = await readValidatedJson(
        layout,
        layout.projectFile,
        projectMetadataSchema,
        false,
      );
      if (!raced || raced.projectId !== projectId) {
        throw new ProjectStoreError(
          "invalid_stored_data",
          "并发创建的 project.json 无效",
        );
      }
      return raced;
    }
    return metadata;
  }

  private async saveArtifact<
    TDraft extends { projectId: string },
    TStored extends { projectId: string; revision: number },
  >(
    input: SaveArtifactInput<unknown>,
    options: SaveArtifactOptions<TDraft, TStored>,
  ): Promise<TStored> {
    assertBaseRevision(input.baseRevision);
    const projectId = parseProjectId(input.projectId);
    const draft = options.draftSchema.parse(input.draft);
    if (draft.projectId !== projectId) {
      throw new ProjectStoreError(
        "cross_reference_invalid",
        "草稿中的 projectId 与目标项目不一致",
      );
    }

    const layout = await ensureProjectLayout(this.dataRoot, projectId);
    const release = await acquireProjectLock(layout);
    try {
      await cleanupTemporaryFiles(layout.projectRoot);
      await this.ensureProjectMetadata(layout, projectId);
      const paths = options.getPaths(layout);
      await cleanupTemporaryFiles(dirname(paths.current));
      await cleanupTemporaryFiles(paths.historyRoot);

      const current = await readValidatedJson(
        layout,
        paths.current,
        options.storedSchema,
        true,
      );
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== input.baseRevision) {
        throw new ProjectStoreError(
          "revision_conflict",
          `修订冲突：期望 ${input.baseRevision}，当前 ${currentRevision}`,
        );
      }

      if (options.validateWithinLock) {
        await options.validateWithinLock(layout, draft);
      }

      const candidate = options.storedSchema.parse({
        ...draft,
        revision: currentRevision + 1,
      });
      const historyPath = join(
        paths.historyRoot,
        `${candidate.revision}.json`,
      );
      const existingHistory = await readValidatedJson(
        layout,
        historyPath,
        options.storedSchema,
        true,
      );
      if (
        existingHistory &&
        !isDeepStrictEqual(existingHistory, candidate)
      ) {
        throw new ProjectStoreError(
          "immutable_history_conflict",
          `历史修订 ${candidate.revision} 已存在且内容不同`,
        );
      }
      if (!existingHistory) {
        const publishResult = await publishImmutableJson(
          historyPath,
          serialize(candidate),
        );
        if (publishResult === "exists") {
          const racedHistory = await readValidatedJson(
            layout,
            historyPath,
            options.storedSchema,
            false,
          );
          if (!isDeepStrictEqual(racedHistory, candidate)) {
            throw new ProjectStoreError(
              "immutable_history_conflict",
              `历史修订 ${candidate.revision} 被并发写入不同内容`,
            );
          }
        }
      }

      await publishCurrentJson(paths.current, serialize(candidate));
      return candidate;
    } finally {
      await release();
    }
  }

  private async loadArtifact<TStored extends { revision: number }>(
    projectIdInput: unknown,
    revision: number | undefined,
    schema: z.ZodType<TStored>,
    getPaths: (layout: ProjectLayout) => ArtifactPaths,
  ): Promise<TStored> {
    const projectId = parseProjectId(projectIdInput);
    if (
      revision !== undefined &&
      (!Number.isInteger(revision) || revision <= 0)
    ) {
      throw new ProjectStoreError(
        "not_found",
        "历史修订必须是正整数",
      );
    }
    const layout = await ensureProjectLayout(this.dataRoot, projectId);
    const metadata = await readValidatedJson(
      layout,
      layout.projectFile,
      projectMetadataSchema,
      true,
    );
    if (!metadata) {
      throw new ProjectStoreError("not_found", `项目不存在：${projectId}`);
    }
    const paths = getPaths(layout);
    const path =
      revision === undefined
        ? paths.current
        : join(paths.historyRoot, `${revision}.json`);
    const value = await readValidatedJson(
      layout,
      path,
      schema,
      true,
    );
    if (!value) {
      throw new ProjectStoreError(
        "not_found",
        `项目数据不存在：${path}`,
      );
    }
    return value;
  }

  private async validateUISpecAgainstDesignBundle(
    layout: ProjectLayout,
    draft: UISpecDraft,
  ): Promise<void> {
    const designBundle = await readValidatedJson(
      layout,
      join(layout.figmaRoot, "current.json"),
      designBundleSchema,
      true,
    );
    if (!designBundle) {
      throw new ProjectStoreError(
        "cross_reference_invalid",
        "保存 UISpec 前必须存在当前 DesignBundle",
      );
    }
    if (
      draft.projectId !== designBundle.projectId ||
      draft.sourceDesignBundleRevision !== designBundle.revision
    ) {
      throw new ProjectStoreError(
        "cross_reference_invalid",
        "UISpec 必须引用同一项目的当前 DesignBundle 修订",
      );
    }

    if (draft.sourceFlowPlanRevision !== undefined) {
      const flowPlan = await readValidatedJson(
        layout,
        join(
          layout.flowHistoryRoot,
          `${draft.sourceFlowPlanRevision}.json`,
        ),
        flowPlanSchema,
        true,
      );
      if (!flowPlan || flowPlan.projectId !== draft.projectId) {
        throw new ProjectStoreError(
          "cross_reference_invalid",
          "UISpec 引用的 FlowPlan 修订不存在或项目不一致",
        );
      }
    }

    const designValueIds = new Set(
      designBundle.designValues.map((item) => item.id),
    );
    const sourcePageIds = new Set(
      designBundle.pages.map((page) => page.id),
    );
    const imagePaths = new Set(
      [...designBundle.assets, ...designBundle.screenshots].map(
        (item) => item.path,
      ),
    );
    const missingDesignValue = draft.designValueRefs.find(
      (id) => !designValueIds.has(id),
    );
    if (missingDesignValue) {
      throw new ProjectStoreError(
        "cross_reference_invalid",
        `UISpec 引用了 DesignBundle 中不存在的设计值：${missingDesignValue}`,
      );
    }
    const missingSourcePage = draft.pages.find(
      (page) => !sourcePageIds.has(page.sourcePageId),
    );
    if (missingSourcePage) {
      throw new ProjectStoreError(
        "cross_reference_invalid",
        `UISpec 引用了 DesignBundle 中不存在的来源页面：${missingSourcePage.sourcePageId}`,
      );
    }
    const missingImage = draft.nodes
      .flatMap((node) =>
        imageRefsForUINode(node).map((assetRef) => ({
          node,
          assetRef,
        })),
      )
      .find((entry) => !imagePaths.has(entry.assetRef));
    if (missingImage) {
      throw new ProjectStoreError(
        "cross_reference_invalid",
        `UISpec 引用了 DesignBundle 中不存在的图片：${missingImage.assetRef}`,
      );
    }

    const nodeById = new Map(draft.nodes.map((node) => [node.id, node]));
    for (const page of draft.pages) {
      const screenshot = rootScreenshotImage(
        nodeById.get(page.rootNodeId),
        nodeById,
      );
      if (screenshot) {
        throw new ProjectStoreError(
          "cross_reference_invalid",
          `full_page_screenshot_fallback_rejected: 页面 ${page.id} 不能以 root 单截图交付，必须保留真实 text/input/button 节点；仅允许局部图片兜底：${screenshot.assetRef}`,
        );
      }
    }
  }

  private async validateFlowPlanReferences(
    layout: ProjectLayout,
    draft: FlowPlanDraft,
  ): Promise<void> {
    const designBundle = await readValidatedJson(
      layout,
      join(layout.figmaRoot, "current.json"),
      designBundleSchema,
      true,
    );
    if (!designBundle) {
      throw new ProjectStoreError(
        "cross_reference_invalid",
        "保存 FlowPlan 前必须存在当前 DesignBundle",
      );
    }
    if (
      draft.projectId !== designBundle.projectId ||
      draft.sourceDesignBundleRevision !== designBundle.revision
    ) {
      throw new ProjectStoreError(
        "cross_reference_invalid",
        "FlowPlan 必须引用同一项目的当前 DesignBundle 修订",
      );
    }

    if (draft.sourceUISpecRevision !== undefined) {
      const uiSpec = await readValidatedJson(
        layout,
        join(
          layout.specsHistoryRoot,
          `${draft.sourceUISpecRevision}.json`,
        ),
        uiSpecSchema,
        true,
      );
      if (!uiSpec || uiSpec.projectId !== draft.projectId) {
        throw new ProjectStoreError(
          "cross_reference_invalid",
          "FlowPlan 引用的 UISpec 修订不存在或项目不一致",
        );
      }
    }
  }
}
