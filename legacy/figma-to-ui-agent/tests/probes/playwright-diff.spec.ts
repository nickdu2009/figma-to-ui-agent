import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const probeCase = process.env.M0_PLAYWRIGHT_CASE;

function documentFor(color: string, offset: number): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; }
      body { background: #ffffff; overflow: hidden; }
      #target {
        position: absolute;
        left: ${40 + offset}px;
        top: 40px;
        width: 160px;
        height: 120px;
        background: ${color};
        border: 4px solid #111111;
      }
    </style>
  </head>
  <body><div id="target"></div></body>
</html>`;
}

test("公开 snapshot API 可比较动态参考图", async ({ page }, testInfo) => {
  if (probeCase !== "same" && probeCase !== "mismatch") {
    throw new Error(`未知 M0_PLAYWRIGHT_CASE: ${String(probeCase)}`);
  }

  await page.setContent(documentFor("#d93f3f", 0));
  const expected = await page.screenshot({
    animations: "disabled",
    caret: "hide",
  });

  const snapshotPath = testInfo.snapshotPath("dynamic.png");
  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, expected);
  await testInfo.attach("probe-expected", {
    body: expected,
    contentType: "image/png",
  });

  if (probeCase === "mismatch") {
    await page.setContent(documentFor("#2563eb", 12));
  }

  const actual = await page.screenshot({
    animations: "disabled",
    caret: "hide",
  });
  await testInfo.attach("probe-actual", {
    body: actual,
    contentType: "image/png",
  });

  expect(actual).toMatchSnapshot("dynamic.png", {
    maxDiffPixelRatio: 0,
    threshold: 0,
  });
});
