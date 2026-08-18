import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, test } from "@playwright/test";

type ReviewCandidate = {
  blindReviewId: string;
  caseId: string;
  candidateSpecPath: string;
};

type UnknownRecord = Record<string, unknown>;

const manifestPath = resolve(process.env.VMA_SPEC_BENCHMARK_REVIEW!);
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
  experimentId: string;
  candidates: ReviewCandidate[];
};
const browserReportPath = process.env.VMA_SPEC_BENCHMARK_BROWSER_REPORT
  ? resolve(process.env.VMA_SPEC_BENCHMARK_BROWSER_REPORT)
  : manifestPath.replace(/\.review\.json$/u, ".browser.jsonl");
const screenshotRoot = resolve(dirname(browserReportPath), "screenshots");

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function staticRoutes(spec: unknown): string[] {
  return Object.keys(record(record(spec)?.routes) ?? {}).filter((route) => !route.includes("["));
}

function eventButtonLabels(spec: unknown, routeKey: string): string[] {
  const root = record(spec) ?? {};
  const route = record(record(root.routes)?.[routeKey]);
  const layoutName = typeof route?.layout === "string" ? route.layout : null;
  const trees = [
    record(route?.page),
    layoutName ? record(record(root.layouts)?.[layoutName]) : null,
  ].filter((tree): tree is UnknownRecord => tree !== null);
  const labels: string[] = [];
  for (const tree of trees) {
    for (const elementValue of Object.values(record(tree.elements) ?? {})) {
      const element = record(elementValue);
      const props = record(element?.props);
      if (
        element?.type === "Button" &&
        record(element.on) &&
        typeof props?.label === "string"
      ) {
        labels.push(props.label);
      }
    }
  }
  return [...new Set(labels)];
}

function routeFileName(route: string): string {
  return route === "/"
    ? "root"
    : route.replaceAll(/[^a-zA-Z0-9_-]/g, "_").replaceAll(/^_+|_+$/g, "") || "route";
}

test.beforeAll(async () => {
  await mkdir(dirname(browserReportPath), { recursive: true });
  await mkdir(screenshotRoot, { recursive: true });
  await writeFile(browserReportPath, "", "utf8");
});

for (const candidate of manifest.candidates) {
  test(`${candidate.caseId} ${candidate.blindReviewId}`, async ({ page }) => {
    const candidatePath = resolve(dirname(manifestPath), candidate.candidateSpecPath);
    const spec = JSON.parse(await readFile(candidatePath, "utf8")) as unknown;
    const routes = staticRoutes(spec);
    const failures: string[] = [];
    if (routes.length === 0) failures.push("no-static-routes");
    const screenshots: string[] = [];
    let interaction: {
      status: "passed" | "failed" | "not_run";
      route?: string;
      label?: string;
    } = { status: "not_run" };

    await page.goto("/");
    await page.waitForFunction(() =>
      typeof (window as unknown as { __previewRuntime?: { applySource?: unknown } })
        .__previewRuntime?.applySource === "function",
    );
    const applyResult = await page.evaluate(async (candidateSpec) => {
      const runtime = (window as unknown as {
        __previewRuntime: { applySource(source: unknown): Promise<{ status: string }> };
      }).__previewRuntime;
      return runtime.applySource({ kind: "object", value: candidateSpec });
    }, spec);
    if (applyResult.status !== "committed") failures.push(`apply:${applyResult.status}`);

    for (const route of routes) {
      await page.evaluate((href) => {
        (window as unknown as { __previewNavigation: { replace(value: string): void } })
          .__previewNavigation.replace(href);
      }, route);
      await page.waitForTimeout(50);
      const status = (await page.getByTestId("preview-status").textContent())?.trim() ?? "";
      if (status !== "ready / ready") failures.push(`${route}:status=${status}`);
      if (await page.getByTestId("preview-error").isVisible().catch(() => false)) {
        failures.push(`${route}:preview-error`);
      }
      const screenshotPath = resolve(
        screenshotRoot,
        candidate.blindReviewId,
        `${routeFileName(route)}.png`,
      );
      await mkdir(dirname(screenshotPath), { recursive: true });
      await page.getByTestId("preview-panel").screenshot({ path: screenshotPath });
      screenshots.push(screenshotPath);

      if (interaction.status === "not_run") {
        for (const label of eventButtonLabels(spec, route)) {
          const button = page.getByRole("button", { name: label, exact: true }).first();
          if (!(await button.isVisible().catch(() => false))) continue;
          const before = await page.evaluate(() =>
            (window as unknown as { __previewRuntimeEvents: string[] })
              .__previewRuntimeEvents.filter((name) => name === "action_settled").length,
          );
          await button.click();
          const dispatched = await expect.poll(async () =>
            page.evaluate(() =>
              (window as unknown as { __previewRuntimeEvents: string[] })
                .__previewRuntimeEvents.filter((name) => name === "action_settled").length,
            ),
          ).toBeGreaterThan(before).then(() => true).catch(() => false);
          interaction = { status: dispatched ? "passed" : "failed", route, label };
          if (!dispatched) failures.push(`${route}:button=${label}:action-not-settled`);
          break;
        }
      }
    }

    await appendFile(browserReportPath, `${JSON.stringify({
      experimentId: manifest.experimentId,
      blindReviewId: candidate.blindReviewId,
      caseId: candidate.caseId,
      applyStatus: applyResult.status,
      staticRoutes: routes.length,
      routesRendered: routes.length - failures.filter((item) => item.includes(":status=") || item.includes(":preview-error")).length,
      interaction,
      screenshots,
      failures,
      status: failures.length === 0 ? "passed" : "failed",
    })}\n`, "utf8");

    expect(failures, "browser benchmark failures are also persisted in the report").toEqual([]);
  });
}
