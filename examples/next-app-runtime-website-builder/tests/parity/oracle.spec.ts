import { expect, test, type Page } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { defaultSpec } from "../../lib/default-spec";

const oracleUrl = process.env.JSON_RENDER_ORACLE_URL!;
const candidateUrl = process.env.NEXT_APP_RUNTIME_CANDIDATE_URL!;

const cases = [
  { path: "/", oracleTitle: "Home | Acme Inc", candidateTitle: "Home | Acme Inc", heading: "Build the future with Acme" },
  { path: "/about", oracleTitle: "About | Acme Inc", candidateTitle: "About | Acme Inc", heading: "About Acme Inc" },
  { path: "/contact", oracleTitle: "Contact | Acme Inc", candidateTitle: "Contact | Acme Inc", heading: "Get in Touch" },
  {
    path: "/builder",
    oracleTitle: "Next Website Builder | json-render",
    candidateTitle: "Next Website Builder | @next-app-runtime/client",
    heading: "Build the future with Acme",
  },
] as const;

const storageKey = "next-app-runtime:website-builder:spec:v1";
const storageEvent = "next-app-runtime:website-builder:spec-change";
const defaultHeadline = "Build the future with Acme";
const editedHeadline = "Edited in the parity flow";

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await page.waitForTimeout(500);
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodePlaywrightPng(png: Buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!png.subarray(0, 8).equals(signature)) throw new Error("Invalid PNG signature");
  let offset = 8;
  let width = 0;
  let height = 0;
  const compressed: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) {
        throw new Error("Parity decoder requires a non-interlaced 8-bit RGB PNG");
      }
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  const bytesPerPixel = 3;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(stride * height);
  let inputOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[inputOffset++];
    const rowOffset = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const value = raw[inputOffset++];
      const left = column >= bytesPerPixel ? pixels[rowOffset + column - bytesPerPixel]! : 0;
      const above = row > 0 ? pixels[rowOffset + column - stride]! : 0;
      const upperLeft = row > 0 && column >= bytesPerPixel
        ? pixels[rowOffset + column - stride - bytesPerPixel]!
        : 0;
      const predictor = filter === 0
        ? 0
        : filter === 1
          ? left
          : filter === 2
            ? above
            : filter === 3
              ? Math.floor((left + above) / 2)
              : filter === 4
                ? paeth(left, above, upperLeft)
                : -1;
      if (predictor < 0) throw new Error(`Unsupported PNG filter ${filter}`);
      pixels[rowOffset + column] = (value + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

function comparePixels(oraclePng: Buffer, candidatePng: Buffer) {
  const oracle = decodePlaywrightPng(oraclePng);
  const candidate = decodePlaywrightPng(candidatePng);
  let changedPixels = -1;
  if (oracle.width === candidate.width && oracle.height === candidate.height) {
    changedPixels = 0;
    for (let offset = 0; offset < oracle.pixels.length; offset += 3) {
      if (
        oracle.pixels[offset] !== candidate.pixels[offset] ||
        oracle.pixels[offset + 1] !== candidate.pixels[offset + 1] ||
        oracle.pixels[offset + 2] !== candidate.pixels[offset + 2]
      ) changedPixels += 1;
    }
  }
  return {
    width: candidate.width,
    height: candidate.height,
    expectedWidth: oracle.width,
    expectedHeight: oracle.height,
    changedPixels,
  };
}

async function editAndExerciseBuilder(page: Page, baseUrl: string, candidate: boolean) {
  if (!candidate) {
    const reset = await page.request.put(new URL("/api/spec", baseUrl).href, { data: defaultSpec });
    expect(reset.ok()).toBe(true);
  }
  await page.goto(new URL("/builder", baseUrl).href);
  if (candidate) {
    await page.evaluate(({ key, eventName }) => {
      localStorage.removeItem(key);
      window.dispatchEvent(new Event(eventName));
    }, { key: storageKey, eventName: storageEvent });
    await page.reload();
  }
  await expect(page.getByText("spec.json", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("/")).toHaveValue("/");
  for (const route of ["Home", "About", "Contact"]) {
    await expect(page.getByText(route, { exact: true }).first()).toBeVisible();
  }

  await page.getByText(defaultHeadline, { exact: true }).first().dblclick();
  const editor = page.locator('input[placeholder="<value>"]');
  await expect(editor).toHaveValue(defaultHeadline);
  await editor.fill(editedHeadline);
  await editor.press("Enter");
  await expect(page.getByRole("heading", { name: editedHeadline })).toBeVisible();
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByRole("heading", { name: editedHeadline })).toBeVisible();
  await settle(page);
  const screenshot = await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" });

  const opened = page.waitForEvent("popup");
  await page.getByRole("link", { name: "View Website" }).click();
  const website = await opened;
  await website.waitForLoadState("domcontentloaded");
  await expect(website.getByRole("heading", {
    name: candidate ? editedHeadline : defaultHeadline,
  })).toBeVisible();
  await expect(website).toHaveTitle("Home | Acme Inc");
  await website.getByRole("link", { name: "About" }).first().click();
  await expect(website).toHaveURL(/\/about$/u);
  await expect(website).toHaveTitle("About | Acme Inc");
  await website.getByRole("link", { name: "Contact" }).first().click();
  await expect(website).toHaveURL(/\/contact$/u);
  await expect(website).toHaveTitle("Contact | Acme Inc");
  await website.goBack();
  await expect(website).toHaveURL(/\/about$/u);
  await website.goForward();
  await expect(website).toHaveURL(/\/contact$/u);
  await website.reload();
  await expect(website.getByRole("heading", { name: "Get in Touch" })).toBeVisible();
  await website.close();

  if (candidate) {
    await page.evaluate(({ key, eventName }) => {
      localStorage.removeItem(key);
      window.dispatchEvent(new Event(eventName));
    }, { key: storageKey, eventName: storageEvent });
  }
  return screenshot;
}

test("matches the official 0.19.0 example behavior and rendered pixels", async ({ context }, testInfo) => {
  const page = await context.newPage();
  const reset = await page.request.put(new URL("/api/spec", oracleUrl).href, { data: defaultSpec });
  expect(reset.ok()).toBe(true);

  for (const entry of cases) {
    await page.goto(new URL(entry.path, oracleUrl).href);
    await settle(page);
    await expect(page).toHaveTitle(entry.oracleTitle);
    await expect(page.getByRole("heading", { name: entry.heading }).first()).toBeVisible();

    if (entry.path === "/builder") {
      await expect(page.getByText("spec.json", { exact: true })).toBeVisible();
      await expect(page.getByPlaceholder("/")).toHaveValue("/");
    }

    const label = entry.path === "/" ? "home" : entry.path.slice(1);
    const oraclePng = await page.screenshot({
      path: testInfo.outputPath(`oracle-${label}.png`),
      fullPage: true,
      animations: "disabled",
      caret: "hide",
    });

    await page.goto(new URL(entry.path, candidateUrl).href);
    await settle(page);
    await expect(page).toHaveTitle(entry.candidateTitle);
    await expect(page.getByRole("heading", { name: entry.heading }).first()).toBeVisible();
    if (entry.path === "/builder") {
      await expect(page.getByText("spec.json", { exact: true })).toBeVisible();
      await expect(page.getByPlaceholder("/")).toHaveValue("/");
    }
    const candidatePng = await page.screenshot({
      path: testInfo.outputPath(`candidate-${label}.png`),
      fullPage: true,
      animations: "disabled",
      caret: "hide",
    });
    const comparison = comparePixels(oraclePng, candidatePng);
    expect(comparison, `pixel output differs for ${entry.path}`).toMatchObject({
      changedPixels: 0,
      width: comparison.expectedWidth,
      height: comparison.expectedHeight,
    });
  }

  const oracleEdited = await editAndExerciseBuilder(page, oracleUrl, false);
  const candidateEdited = await editAndExerciseBuilder(page, candidateUrl, true);
  const editedComparison = comparePixels(oracleEdited, candidateEdited);
  expect(editedComparison, "pixel output differs after Visual JSON edit").toMatchObject({
    changedPixels: 0,
    width: editedComparison.expectedWidth,
    height: editedComparison.expectedHeight,
  });
});
