import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import type {
  DesignBundle,
  LocalImageRef,
} from "../design-bundle/schema.ts";
import {
  assertManagedFilePath,
  assertNotSymlink,
  ensureProjectLayout,
  resolveProjectPath,
} from "../project-store/path-safety.ts";
import { ProjectStore } from "../project-store/store.ts";
import { SCHEMA_VERSION } from "../project-store/schemas.ts";
import {
  startPreviewServer,
  type RunningPreviewServer,
} from "../preview/server.ts";
import {
  type RenderAndCompareInput,
  type RenderAndCompareOutput,
  renderAndCompareInputSchema,
  renderAndCompareOutputSchema,
} from "../tools/contracts.ts";
import { collectScreenshotFallbackFeatures } from "../tools/unsupported-features.ts";
import type { UISpec } from "../ui-spec/schema.ts";
import {
  type ValidationRecord,
  validationRecordSchema,
} from "./schema.ts";
import { VALIDATION_BASELINE } from "./baseline.ts";

type ValidationCheck =
  RenderAndCompareOutput["results"][number]["checks"][number];

export type RenderValidationErrorCode =
  | "target_not_found"
  | "fixture_target_invalid"
  | "reference_screenshot_missing"
  | "cancelled";

export class RenderValidationError extends Error {
  readonly code: RenderValidationErrorCode;

  constructor(code: RenderValidationErrorCode, message: string) {
    super(message);
    this.name = "RenderValidationError";
    this.code = code;
  }
}

export interface RenderAndCompareServiceOptions {
  dataRoot: string;
  projectStore: ProjectStore;
  browserExecutablePath?: string;
  previewPort?: number;
  now?: () => Date;
  runId?: () => string;
}

interface PixelComparison {
  diffPixelCount: number;
  diffPixelRatio: number;
  diffBytes?: Uint8Array;
  message?: string;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueRequested(
  requested: readonly string[] | undefined,
  available: readonly string[],
  label: string,
): string[] {
  const selected = requested?.length
    ? [...new Set(requested)]
    : [...available];
  const availableSet = new Set(available);
  const missing = selected.find((id) => !availableSet.has(id));
  if (missing) {
    throw new RenderValidationError(
      "target_not_found",
      `${label}不存在`,
    );
  }
  return selected;
}

function screenshotForSourcePage(
  bundle: DesignBundle,
  sourcePageId: string,
): LocalImageRef | undefined {
  const sourceHash = bundle.provenance.find(
    (entry) =>
      entry.entityKind === "page" &&
      entry.entityId === sourcePageId,
  )?.sourceIdHash;
  const path = sourceHash
    ? bundle.provenance.find(
        (entry) =>
          entry.entityKind === "screenshot" &&
          entry.sourceIdHash === sourceHash,
      )?.entityId
    : undefined;
  return bundle.screenshots.find(
    (screenshot) => screenshot.path === path,
  );
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAtomic(
  destination: string,
  content: string | Uint8Array,
): Promise<void> {
  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, destination);
    await syncDirectory(dirname(destination));
  } finally {
    await rm(temporary, { force: true });
  }
}

function runArtifactPath(
  runId: string,
  kind: "screenshots" | "diffs",
  filename: string,
): string {
  return `runs/${runId}/${kind}/${filename}`;
}

function previewUrl(
  baseUrl: string,
  input: {
    projectId: string;
    pageId: string;
    viewportId: string;
    uiSpecRevision: number;
    designBundleRevision: number;
    runId?: string;
    canvasOnly?: boolean;
  },
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("projectId", input.projectId);
  url.searchParams.set("pageId", input.pageId);
  url.searchParams.set("viewportId", input.viewportId);
  url.searchParams.set(
    "specRevision",
    String(input.uiSpecRevision),
  );
  url.searchParams.set(
    "designRevision",
    String(input.designBundleRevision),
  );
  if (input.runId) {
    url.searchParams.set("runId", input.runId);
  }
  if (input.canvasOnly) {
    url.searchParams.set("renderMode", "canvas");
  }
  return url.href;
}

async function comparePixels(
  page: Page,
  expectedBytes: Uint8Array,
  actualBytes: Uint8Array,
  expected: LocalImageRef,
  actualWidth: number,
  actualHeight: number,
): Promise<PixelComparison> {
  const width = actualWidth;
  const height = actualHeight;
  const totalPixels = width * height;
  if (totalPixels > VALIDATION_BASELINE.maxComparePixels) {
    return {
      diffPixelCount: totalPixels,
      diffPixelRatio: 1,
      message: "比较画布超过像素上限",
    };
  }
  await page.setContent(
    '<canvas id="expected"></canvas><canvas id="actual"></canvas><canvas id="diff"></canvas>',
  );
  const result = await page.evaluate(
    async (input) => {
      const load = async (base64: string, mimeType: string) => {
        const image = new Image();
        image.src = `data:${mimeType};base64,${base64}`;
        await image.decode();
        return image;
      };
      const expectedImage = await load(
        input.expectedBase64,
        input.expectedMime,
      );
      const actualImage = await load(
        input.actualBase64,
        "image/png",
      );
      const width = actualImage.naturalWidth;
      const height = actualImage.naturalHeight;
      const read = (
        id: string,
        image: HTMLImageElement,
        mode: "reference" | "actual",
      ): ImageData => {
        const canvas = document.getElementById(id) as HTMLCanvasElement;
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", {
          willReadFrequently: true,
        })!;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        if (mode === "reference") {
          const scale = width / image.naturalWidth;
          const sourceHeight = Math.min(
            image.naturalHeight,
            height / scale,
          );
          context.drawImage(
            image,
            0,
            0,
            image.naturalWidth,
            sourceHeight,
            0,
            0,
            width,
            sourceHeight * scale,
          );
        } else {
          context.drawImage(image, 0, 0);
        }
        return context.getImageData(0, 0, width, height);
      };
      const left = read("expected", expectedImage, "reference");
      const right = read("actual", actualImage, "actual");
      const diffCanvas = document.getElementById(
        "diff",
      ) as HTMLCanvasElement;
      diffCanvas.width = width;
      diffCanvas.height = height;
      const diffContext = diffCanvas.getContext("2d")!;
      const diff = diffContext.createImageData(width, height);
      let diffPixelCount = 0;
      for (let index = 0; index < left.data.length; index += 4) {
        const channelDelta = Math.max(
          Math.abs(left.data[index] - right.data[index]),
          Math.abs(left.data[index + 1] - right.data[index + 1]),
          Math.abs(left.data[index + 2] - right.data[index + 2]),
          Math.abs(left.data[index + 3] - right.data[index + 3]),
        );
        const changed =
          channelDelta > input.maxChannelDelta;
        if (changed) {
          diffPixelCount += 1;
          diff.data[index] = 214;
          diff.data[index + 1] = 55;
          diff.data[index + 2] = 55;
          diff.data[index + 3] = 255;
        }
      }
      diffContext.putImageData(diff, 0, 0);
      return {
        diffPixelCount,
        diffPixelRatio:
          width * height === 0
            ? 0
            : diffPixelCount / (width * height),
        diffDataUrl: diffCanvas.toDataURL("image/png"),
      };
    },
    {
      expectedBase64: Buffer.from(expectedBytes).toString("base64"),
      expectedMime: expected.mimeType,
      actualBase64: Buffer.from(actualBytes).toString("base64"),
      maxChannelDelta: VALIDATION_BASELINE.maxChannelDelta,
    },
  );
  return {
    diffPixelCount: result.diffPixelCount,
    diffPixelRatio: result.diffPixelRatio,
    diffBytes: Uint8Array.from(
      Buffer.from(result.diffDataUrl.split(",", 2)[1]!, "base64"),
    ),
  };
}

function targetForStep(
  page: Page,
  nodeId: string,
) {
  const escaped = [...nodeId]
    .map((character) => `\\${character.codePointAt(0)!.toString(16)} `)
    .join("");
  return page.locator(
    `[data-ui-node-id="${escaped}"]`,
  );
}

async function executeBehaviorFixture(
  page: Page,
  fixture: UISpec["behaviorFixtures"][number],
): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  for (const step of fixture.steps) {
    try {
      if (step.kind === "click") {
        await targetForStep(page, step.nodeId).click();
      } else if (step.kind === "fill") {
        await targetForStep(page, step.nodeId)
          .locator("input")
          .fill(step.value);
      } else if (step.kind === "toggle") {
        await targetForStep(page, step.nodeId)
          .locator('input[type="checkbox"]')
          .click();
      } else if (step.kind === "expect_visible") {
        if (!(await targetForStep(page, step.nodeId).isVisible())) {
          throw new Error("目标不可见");
        }
      } else if (step.kind === "expect_text") {
        const text = await targetForStep(
          page,
          step.nodeId,
        ).textContent();
        if (!text?.includes(step.text)) {
          throw new Error("文本不匹配");
        }
      } else {
        const activePageId = await page
          .locator(".implementation-canvas")
          .getAttribute("data-page-id");
        if (activePageId !== step.pageId) {
          throw new Error("页面不匹配");
        }
      }
      checks.push({
        kind: "functional",
        passed: true,
        message: `${fixture.id}:${step.kind}`,
      });
    } catch {
      checks.push({
        kind: "functional",
        passed: false,
        message: `${fixture.id}:${step.kind} 未通过`,
      });
      break;
    }
  }
  return checks;
}

async function keyboardCheck(
  page: Page,
): Promise<ValidationCheck> {
  const interactiveCount = await page
    .locator("button,input,select,[tabindex]")
    .count();
  if (interactiveCount < 1) {
    return {
      kind: "keyboard",
      passed: true,
      message: "页面没有可交互控件",
    };
  }
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    document.body.removeAttribute("tabindex");
    const active = document.activeElement;
    if (!active || active === document.body) {
      return {
        focused: false,
        visible: false,
        tag: active?.tagName ?? "none",
        outlineStyle: "none",
        outlineWidth: "0px",
      };
    }
    const style = getComputedStyle(active);
    return {
      focused: true,
      visible:
        style.outlineStyle !== "none" &&
        Number.parseFloat(style.outlineWidth) > 0,
      tag: active.tagName,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  return {
    kind: "keyboard",
    passed: focus.focused && focus.visible,
    message:
      focus.focused && focus.visible
        ? "首个交互控件具有可见焦点"
        : `键盘焦点不可见：${focus.tag}/${focus.outlineStyle}/${focus.outlineWidth}`,
  };
}

export class RenderAndCompareService {
  private readonly dataRoot: string;
  private readonly projectStore: ProjectStore;
  private readonly browserExecutablePath: string | undefined;
  private readonly previewPort: number | undefined;
  private readonly now: () => Date;
  private readonly createRunId: () => string;
  private previewServer?: RunningPreviewServer;
  private browser?: Browser;
  private closePromise?: Promise<void>;

  constructor(options: RenderAndCompareServiceOptions) {
    this.dataRoot = options.dataRoot;
    this.projectStore = options.projectStore;
    this.browserExecutablePath = options.browserExecutablePath;
    this.previewPort = options.previewPort;
    this.now = options.now ?? (() => new Date());
    this.createRunId =
      options.runId ??
      (() =>
        `${Date.now().toString(36)}-${randomUUID().replaceAll("-", "")}`);
  }

  async render(
    rawInput: unknown,
    signal?: AbortSignal,
  ): Promise<RenderAndCompareOutput> {
    if (signal?.aborted) {
      throw new RenderValidationError(
        "cancelled",
        "渲染与比较已取消",
      );
    }
    const closeOnAbort = () => {
      void this.close().catch(() => undefined);
    };
    signal?.addEventListener("abort", closeOnAbort, {
      once: true,
    });
    try {
      return await this.renderInternal(rawInput, signal);
    } catch (error) {
      await this.close().catch(() => undefined);
      if (signal?.aborted) {
        throw new RenderValidationError(
          "cancelled",
          "渲染与比较已取消",
        );
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", closeOnAbort);
    }
  }

  private async renderInternal(
    rawInput: unknown,
    signal?: AbortSignal,
  ): Promise<RenderAndCompareOutput> {
    const input = renderAndCompareInputSchema.parse(rawInput);
    const [bundle, uiSpec] = await Promise.all([
      this.projectStore.loadDesignBundle(input.projectId),
      this.projectStore.loadUISpec(input.projectId),
    ]);
    const pageIds = uniqueRequested(
      input.pageIds,
      uiSpec.pages.map((page) => page.id),
      "页面",
    );
    const viewportIds = uniqueRequested(
      input.viewportIds,
      uiSpec.viewports.map((viewport) => viewport.id),
      "视口",
    );
    const fixtureIds = uniqueRequested(
      input.behaviorFixtureIds,
      uiSpec.behaviorFixtures.map((fixture) => fixture.id),
      "行为夹具",
    );
    const fixtures = uiSpec.behaviorFixtures.filter((fixture) =>
      fixtureIds.includes(fixture.id),
    );
    const invalidFixture = fixtures.find(
      (fixture) =>
        !pageIds.includes(fixture.initialPageId) ||
        !viewportIds.includes(fixture.viewportId),
    );
    if (invalidFixture) {
      throw new RenderValidationError(
        "fixture_target_invalid",
        "行为夹具不在所选页面或视口范围内",
      );
    }

    const runId = this.createRunId();
    const layout = await ensureProjectLayout(
      this.dataRoot,
      input.projectId,
    );
    const runRoot = join(layout.runsRoot, runId);
    const screenshotRoot = join(runRoot, "screenshots");
    const diffRoot = join(runRoot, "diffs");
    await mkdir(runRoot);
    await mkdir(screenshotRoot);
    await mkdir(diffRoot);
    await Promise.all([
      assertNotSymlink(runRoot, "directory"),
      assertNotSymlink(screenshotRoot, "directory"),
      assertNotSymlink(diffRoot, "directory"),
    ]);

    const server = await this.getPreviewServer();
    if (signal?.aborted) {
      throw new RenderValidationError(
        "cancelled",
        "渲染与比较已取消",
      );
    }
    const browser = await this.getBrowser();
    if (signal?.aborted) {
      throw new RenderValidationError(
        "cancelled",
        "渲染与比较已取消",
      );
    }
    const comparisonPage = await browser.newPage();
    const results: RenderAndCompareOutput["results"] = [];
    try {
      let resultIndex = 0;
      for (const pageId of pageIds) {
        if (signal?.aborted) {
          throw new RenderValidationError(
            "cancelled",
            "渲染与比较已取消",
          );
        }
        const uiPage = uiSpec.pages.find(
          (candidate) => candidate.id === pageId,
        )!;
        const expectedRef = screenshotForSourcePage(
          bundle,
          uiPage.sourcePageId,
        );
        if (!expectedRef) {
          throw new RenderValidationError(
            "reference_screenshot_missing",
            "UISpec 来源页面缺少参考截图",
          );
        }
        const expectedPath = resolveProjectPath(
          layout,
          expectedRef.path,
        );
        await assertManagedFilePath(layout, expectedPath);
        const expectedBytes = await readFile(expectedPath);
        for (const viewportId of viewportIds) {
          if (signal?.aborted) {
            throw new RenderValidationError(
              "cancelled",
              "渲染与比较已取消",
            );
          }
          const viewport = uiSpec.viewports.find(
            (candidate) => candidate.id === viewportId,
          )!;
          const context: BrowserContext = await browser.newContext({
            viewport: {
              width: viewport.width + 32,
              height: viewport.height + 32,
            },
            deviceScaleFactor: viewport.deviceScaleFactor,
            colorScheme: VALIDATION_BASELINE.colorScheme,
            reducedMotion: VALIDATION_BASELINE.reducedMotion,
            locale: VALIDATION_BASELINE.locale,
            timezoneId: VALIDATION_BASELINE.timezoneId,
            serviceWorkers: VALIDATION_BASELINE.serviceWorkers,
          });
          const page = await context.newPage();
          page.setDefaultTimeout(input.comparison.timeoutMs);
          page.setDefaultNavigationTimeout(input.comparison.timeoutMs);
          const consoleErrors: string[] = [];
          const pageErrors: string[] = [];
          page.on("console", (message) => {
            if (message.type() === "error") {
              consoleErrors.push(message.text());
            }
          });
          page.on("pageerror", (error) => {
            pageErrors.push(error.message);
          });

          const artifactName = `${String(resultIndex).padStart(
            3,
            "0",
          )}-${stableHash(`${pageId}:${viewportId}`).slice(0, 12)}`;
          resultIndex += 1;
          const expectedExtension =
            expectedRef.path.split(".").at(-1) ?? "png";
          const expectedRelative = runArtifactPath(
            runId,
            "screenshots",
            `${artifactName}-expected.${expectedExtension}`,
          );
          const actualRelative = runArtifactPath(
            runId,
            "screenshots",
            `${artifactName}-actual.png`,
          );
          const diffRelative = runArtifactPath(
            runId,
            "diffs",
            `${artifactName}-diff.png`,
          );
          try {
            await page.goto(
              previewUrl(server.url, {
                projectId: input.projectId,
                pageId,
                viewportId,
                uiSpecRevision: uiSpec.revision,
                designBundleRevision: bundle.revision,
                canvasOnly: true,
              }),
              { waitUntil: "networkidle" },
            );
            await page.addStyleTag({
              content:
                "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
            });
            await page.evaluate(async () => {
              await document.fonts.ready;
            });
            const canvas = page.locator(".implementation-canvas");
            await canvas.waitFor();
            const actualBytes = await canvas.screenshot({
              animations: "disabled",
              type: "png",
            });
            await writeAtomic(
              join(runRoot, "screenshots", basename(expectedRelative)),
              expectedBytes,
            );
            await writeAtomic(
              join(runRoot, "screenshots", basename(actualRelative)),
              actualBytes,
            );
            const comparison = await comparePixels(
              comparisonPage,
              expectedBytes,
              actualBytes,
              expectedRef,
              viewport.width * viewport.deviceScaleFactor,
              viewport.height * viewport.deviceScaleFactor,
            );
            if (comparison.diffBytes) {
              await writeAtomic(
                join(runRoot, "diffs", basename(diffRelative)),
                comparison.diffBytes,
              );
            }

            const checks: ValidationCheck[] = [
              {
                kind: "functional",
                passed: true,
                message: "Preview 页面与实现画布加载成功",
              },
            ];
            for (const fixture of fixtures.filter(
              (candidate) =>
                candidate.initialPageId === pageId &&
                candidate.viewportId === viewportId,
            )) {
              checks.push(
                ...(await executeBehaviorFixture(
                  page,
                  fixture,
                )),
              );
            }
            checks.push(await keyboardCheck(page));
            checks.push({
              kind: "console",
              passed:
                consoleErrors.length === 0 &&
                pageErrors.length === 0,
              message:
                consoleErrors.length === 0 && pageErrors.length === 0
                  ? "无控制台或页面错误"
                  : `捕获 ${consoleErrors.length + pageErrors.length} 个错误`,
            });
            const visualPassed =
              comparison.diffPixelCount <=
                input.comparison.maxDiffPixels &&
              comparison.diffPixelRatio <=
                input.comparison.maxDiffPixelRatio;
            checks.push({
              kind: "visual",
              passed: visualPassed,
              message:
                comparison.message ??
                `差异像素 ${comparison.diffPixelCount}，比例 ${comparison.diffPixelRatio.toFixed(
                  6,
                )}`,
            });
            results.push({
              pageId,
              viewportId,
              checks,
              expectedImage: expectedRelative,
              actualImage: actualRelative,
              diffImage: comparison.diffBytes
                ? diffRelative
                : undefined,
              diffPixelCount: comparison.diffPixelCount,
              diffPixelRatio: comparison.diffPixelRatio,
            });
          } finally {
            await context.close();
          }
        }
      }
    } finally {
      await comparisonPage.close();
    }

    const unsupportedFeatures = collectScreenshotFallbackFeatures(
      uiSpec,
      "validation_artifact",
    );
    const output = renderAndCompareOutputSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      projectId: input.projectId,
      runId,
      previewUrl: previewUrl(server.url, {
        projectId: input.projectId,
        pageId: pageIds[0]!,
        viewportId: viewportIds[0]!,
        uiSpecRevision: uiSpec.revision,
        designBundleRevision: bundle.revision,
        runId,
      }),
      passed: results.every((result) =>
        result.checks.every((check) => check.passed),
      ),
      results,
      ...(unsupportedFeatures.length > 0 ? { unsupportedFeatures } : {}),
    });
    const record: ValidationRecord = validationRecordSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      runId,
      projectId: input.projectId,
      designBundleRevision: bundle.revision,
      uiSpecRevision: uiSpec.revision,
      createdAt: this.now().toISOString(),
      input,
      runtime: {
        ...VALIDATION_BASELINE,
        chromiumVersion: browser.version(),
      },
      output,
    });
    await writeAtomic(
      join(runRoot, "validation.json"),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    return output;
  }

  async close(): Promise<void> {
    this.closePromise ??= this.closeRuntime();
    try {
      await this.closePromise;
    } finally {
      this.closePromise = undefined;
    }
  }

  private async closeRuntime(): Promise<void> {
    const browser = this.browser;
    const previewServer = this.previewServer;
    this.browser = undefined;
    this.previewServer = undefined;
    const results = await Promise.allSettled([
      browser?.close(),
      previewServer?.close(),
    ]);
    const failure = results.find(
      (result) => result.status === "rejected",
    );
    if (failure?.status === "rejected") {
      throw failure.reason;
    }
  }

  private async getPreviewServer(): Promise<RunningPreviewServer> {
    this.previewServer ??= await startPreviewServer({
      dataRoot: this.dataRoot,
      port: this.previewPort,
    });
    return this.previewServer;
  }

  private async getBrowser(): Promise<Browser> {
    this.browser ??= await chromium.launch({
      headless: true,
      executablePath: this.browserExecutablePath,
    });
    return this.browser;
  }
}
