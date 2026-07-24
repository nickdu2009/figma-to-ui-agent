import { expect, test } from "@playwright/test";

const exactRevisionUrl =
  "/?projectId=m2-preview&pageId=home&viewportId=desktop&specRevision=1&designRevision=1&runId=m2-probe-run";

test("三栏 Preview 支持原生表单、键盘、页面交互和工具控制", async ({
  page,
}) => {
  await page.goto(exactRevisionUrl);

  await expect(page.locator(".workspace-panel")).toHaveCount(3);
  await expect(page.getByText("Figma 参考", { exact: true })).toBeVisible();
  await expect(page.getByText("当前实现", { exact: true })).toBeVisible();
  await expect(page.getByText("检查结果", { exact: true })).toBeVisible();
  await expect(page.getByLabel("页面")).toHaveValue("home");
  await expect(page.getByLabel("视口")).toHaveValue("desktop");
  await expect(page.getByAltText("首页 参考截图")).toBeVisible();

  const email = page.getByLabel("邮箱");
  const terms = page.getByLabel("同意条款");
  await email.fill("e2e@example.com");
  await expect(email).toHaveValue("e2e@example.com");
  await terms.check();
  await expect(terms).toBeChecked();
  await email.focus();
  await page.keyboard.press("Tab");
  await expect(terms).toBeFocused();
  await expect(terms).toHaveCSS("outline-style", "solid");

  await page.getByRole("button", { name: "继续" }).click();
  await expect(
    page.locator(".implementation-canvas"),
  ).toHaveAttribute("data-page-id", "details");
  await expect(page).toHaveURL(/pageId=details/);
  await page.getByRole("button", { name: "返回首页" }).click();
  await expect(
    page.locator(".implementation-canvas"),
  ).toHaveAttribute("data-page-id", "home");

  await page.getByRole("button", { name: "放大" }).click();
  await expect(page.locator(".zoom-control output")).toHaveText(
    "110%",
  );
  await page.getByLabel("像素").check();
  await expect(
    page.locator(".implementation-scale"),
  ).toHaveClass(/is-pixelated/);
});

test("Preview 使用原生 disabled 并阻止动作、状态修改和键盘焦点", async ({
  page,
}) => {
  await page.goto(
    "/?projectId=m2-preview&pageId=home&viewportId=desktop&specRevision=2&designRevision=1",
  );

  const email = page.getByLabel("邮箱");
  const terms = page.getByLabel("同意条款");
  const continueButton = page.getByRole("button", { name: "继续" });
  await expect(email).toBeDisabled();
  await expect(terms).toBeDisabled();
  await expect(continueButton).toBeDisabled();

  await email.evaluate((element) => element.focus());
  await page.keyboard.type("blocked@example.com");
  await expect(email).toHaveValue("");
  await terms.evaluate((element) =>
    (element as HTMLInputElement).click(),
  );
  await expect(terms).not.toBeChecked();
  await continueButton.evaluate((element) =>
    (element as HTMLButtonElement).click(),
  );
  await expect(
    page.locator(".implementation-canvas"),
  ).toHaveAttribute("data-page-id", "home");

  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () =>
          document.activeElement instanceof HTMLButtonElement ||
          document.activeElement instanceof HTMLInputElement
            ? document.activeElement.disabled
            : false,
      ),
    ).toBe(false);
  }
});

test("Preview 明确呈现 loading、empty、error 和 stale 状态", async ({
  page,
}) => {
  let releaseRequests: (() => void) | undefined;
  const requestsReleased = new Promise<void>((resolveRequests) => {
    releaseRequests = resolveRequests;
  });
  await page.route("**/api/projects/m2-preview/**", async (route) => {
    await requestsReleased;
    await route.continue();
  });
  await page.goto(exactRevisionUrl, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("正在加载", { exact: true })).toBeVisible();
  releaseRequests?.();
  await expect(page.locator(".workspace-panel")).toHaveCount(3);
  await page.unroute("**/api/projects/m2-preview/**");

  await page.goto("/");
  await expect(page.getByText("暂无项目", { exact: true })).toBeVisible();

  await page.goto("/?projectId=bad!");
  await expect(page.getByText("加载失败", { exact: true })).toBeVisible();

  await page.goto(
    "/?projectId=m2-preview&pageId=home&viewportId=desktop&runId=m2-probe-run",
  );
  await expect(page.locator(".stale-banner")).toHaveText(
    "当前显示修订与验证记录不一致",
  );
});

test("移动视口按参考、实现、检查结果顺序堆叠", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    exactRevisionUrl.replace(
      "viewportId=desktop",
      "viewportId=mobile",
    ),
  );
  const panels = page.locator(".workspace-panel");
  await expect(panels).toHaveCount(3);
  const boxes = await panels.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { y: box.y, width: box.width };
    }),
  );
  expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y);
  expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y);
  expect(boxes.every((box) => box.width <= 390)).toBe(true);

  const screenshot = await page.screenshot({
    path: testInfo.outputPath("preview-mobile.png"),
    fullPage: true,
  });
  await testInfo.attach("preview-mobile", {
    body: screenshot,
    contentType: "image/png",
  });
});
