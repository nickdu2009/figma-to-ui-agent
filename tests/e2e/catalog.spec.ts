import { expect, test } from "@playwright/test";

test("renders catalog overview with component cards", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("h1")).toHaveText("组件库预览");

  const cards = page.locator(".component-card");
  await expect(cards.first()).toBeVisible();

  await expect(
    page.locator(".component-card", { hasText: "Stack" }),
  ).toBeVisible();
  await expect(
    page.locator(".component-card", { hasText: "Button" }),
  ).toBeVisible();
  await expect(
    page.locator(".component-card", { hasText: "Tabs" }),
  ).toBeVisible();
});

test("Button card renders the fixture and reacts to prop changes", async ({
  page,
}) => {
  await page.goto("/");

  const buttonCard = page.locator(".component-card", {
    hasText: "受控按钮",
  });
  await expect(buttonCard).toBeVisible();

  const button = buttonCard.locator("button");
  await expect(button).toHaveText("提交");

  await button.click();
  await expect(buttonCard.getByText("按钮已被点击")).toBeVisible();

  const labelInput = buttonCard
    .locator('label:has-text("label") input[type="text"]')
    .first();
  await labelInput.fill("保存");
  await expect(button).toHaveText("保存");
});

test("Button card rejects invalid prop values without crashing", async ({
  page,
}) => {
  await page.goto("/");

  const buttonCard = page.locator(".component-card", {
    hasText: "受控按钮",
  });
  const button = buttonCard.locator("button");
  await expect(button).toHaveText("提交");

  const labelInput = buttonCard
    .locator('label:has-text("label") input[type="text"]')
    .first();
  // label 在 schema 中要求 minLength=1，清空应被控件拒绝
  await labelInput.fill("");
  await expect(button).toHaveText("提交");
  await expect(labelInput).toHaveValue("提交");

  await labelInput.fill("保存");
  await expect(button).toHaveText("保存");
});

test("Input card supports typing", async ({ page }) => {
  await page.goto("/");

  const inputCard = page.locator(".component-card", {
    hasText: "绑定字符串状态的输入框",
  });
  await expect(inputCard).toBeVisible();

  const input = inputCard.locator('input[type="email"]').first();
  await input.fill("hello@example.com");
  await expect(input).toHaveValue("hello@example.com");
});

test("Tabs card switches panels", async ({ page }) => {
  await page.goto("/");

  const tabsCard = page.locator(".component-card", {
    hasText: "选项卡",
  });
  await expect(tabsCard).toBeVisible();

  await expect(tabsCard.getByText("常规面板内容")).toBeVisible();

  await tabsCard.getByRole("tab", { name: "高级" }).click();
  await expect(tabsCard.getByText("高级面板内容")).toBeVisible();
  await expect(tabsCard.getByText("常规面板内容")).toBeHidden();
});

test("Link card click dispatches demo action and opens feedback dialog", async ({
  page,
}) => {
  await page.goto("/");

  const linkCard = page.locator(".component-card", {
    hasText: "导航链接",
  });
  await expect(linkCard).toBeVisible();

  const link = linkCard.locator("a, [role='link']").first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(linkCard.getByText("链接已被点击")).toBeVisible();
  // 导航动作不产生实际跳转
  await expect(page.locator("h1")).toHaveText("组件库预览");
});
