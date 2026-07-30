import { expect, test } from "@playwright/test";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ProjectStore } from "../../src/project-store/store.ts";
import {
  createDesignBundleDraft,
  createUISpecDraft,
} from "../fixtures/contracts.ts";

const PROJECT_ID = "p1-components-e2e";

async function seedProject(): Promise<void> {
  // 保证测试可重复运行：先清除已存在的项目目录
  const projectRoot = resolve(join("data", "projects", PROJECT_ID));
  try {
    await rm(projectRoot, { recursive: true, force: true });
  } catch {
    // 目录不存在时忽略
  }
  const store = new ProjectStore("data");
  const bundle = createDesignBundleDraft(PROJECT_ID);
  bundle.pages.push({
    id: "page-details",
    name: "详情",
    width: 1440,
    height: 900,
    rootNodeIds: ["figma-details-root"],
    nodes: [
      {
        id: "figma-details-root",
        kind: "container",
        name: "Details",
        visible: true,
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    ],
  });
  await store.saveDesignBundle({
    projectId: PROJECT_ID,
    baseRevision: 0,
    draft: bundle,
  });
  const draft = createUISpecDraft(PROJECT_ID);
  draft.state.push(
    { key: "name", valueType: "string", initialValue: "" },
    { key: "bio", valueType: "string", initialValue: "" },
    { key: "country", valueType: "string", initialValue: "" },
    { key: "absolute", valueType: "string", initialValue: "" },
    { key: "notify", valueType: "boolean", initialValue: false },
    { key: "plan", valueType: "string", initialValue: "" },
    { key: "activeTab", valueType: "string", initialValue: "general" },
    { key: "variantState", valueType: "string", initialValue: "source" },
  );
  draft.actions.push(
    { id: "go-details", kind: "navigate", pageId: "details" },
    { id: "go-home", kind: "navigate", pageId: "home" },
    { id: "show-target", kind: "set_state", stateKey: "variantState", value: "target" },
  );
  draft.pages = [
    {
      id: "home",
      sourcePageId: "page-home",
      path: "/",
      title: "首页",
      rootNodeId: "root",
    },
    {
      id: "details",
      sourcePageId: "page-details",
      path: "/details",
      title: "详情",
      rootNodeId: "details-root",
    },
  ];
  draft.behaviorFixtures = [];
  draft.nodes = [
    {
      id: "root",
      kind: "stack",
      direction: "vertical",
      gap: 12,
      padding: 16,
      style: {
        minHeight: 520,
        position: "relative",
      },
      childIds: [
        "name-field",
        "absolute-input",
        "bio-field",
        "country-select",
        "notify-switch",
        "plan-radio-a",
        "plan-radio-b",
        "tabs",
        "variant-source",
        "variant-target",
        "details-link",
      ],
      designValueRefs: [],
    },
    {
      id: "absolute-input",
      kind: "input",
      label: "绝对定位输入",
      stateKey: "absolute",
      inputType: "text",
      placeholder: "Framed input",
      style: {
        position: "absolute",
        left: 420,
        top: 16,
        width: 220,
        height: 44,
        backgroundColor: "#dde6ef",
        borderRadius: 12,
      },
      designValueRefs: [],
    },
    {
      id: "name-field",
      kind: "form_field",
      label: "姓名",
      required: true,
      childIds: ["name-input"],
      designValueRefs: [],
    },
    {
      id: "name-input",
      kind: "input",
      label: "姓名",
      stateKey: "name",
      inputType: "text",
      designValueRefs: [],
    },
    {
      id: "bio-field",
      kind: "form_field",
      label: "简介",
      helpText: "简单介绍你自己",
      childIds: ["bio-textarea"],
      designValueRefs: [],
    },
    {
      id: "bio-textarea",
      kind: "textarea",
      label: "简介",
      stateKey: "bio",
      designValueRefs: [],
    },
    {
      id: "country-select",
      kind: "select",
      label: "国家",
      stateKey: "country",
      options: [
        { value: "cn", label: "中国" },
        { value: "us", label: "美国" },
      ],
      designValueRefs: [],
    },
    {
      id: "notify-switch",
      kind: "switch",
      label: "接收通知",
      stateKey: "notify",
      designValueRefs: [],
    },
    {
      id: "plan-radio-a",
      kind: "radio",
      label: "基础版",
      stateKey: "plan",
      value: "basic",
      designValueRefs: [],
    },
    {
      id: "plan-radio-b",
      kind: "radio",
      label: "专业版",
      stateKey: "plan",
      value: "pro",
      designValueRefs: [],
    },
    {
      id: "tabs",
      kind: "tabs",
      stateKey: "activeTab",
      tabs: [
        {
          value: "general",
          label: "常规",
          childIds: ["general-text"],
        },
        {
          value: "advanced",
          label: "高级",
          childIds: ["advanced-text"],
        },
      ],
      designValueRefs: [],
    },
    {
      id: "general-text",
      kind: "text",
      text: "常规面板",
      variant: "body",
      designValueRefs: [],
    },
    {
      id: "advanced-text",
      kind: "text",
      text: "高级面板",
      variant: "body",
      designValueRefs: [],
    },
    {
      id: "details-link",
      kind: "link",
      label: "去详情",
      actionId: "go-details",
      designValueRefs: [],
    },
    {
      id: "variant-source",
      kind: "stack",
      direction: "vertical",
      childIds: ["variant-button"],
      visibleWhen: {
        stateKey: "variantState",
        equals: "source",
      },
      designValueRefs: [],
    },
    {
      id: "variant-button",
      kind: "button",
      label: "切换 Variant",
      actionId: "show-target",
      variant: "secondary",
      designValueRefs: [],
    },
    {
      id: "variant-target",
      kind: "text",
      text: "Target Variant",
      variant: "body",
      visibleWhen: {
        stateKey: "variantState",
        equals: "target",
      },
      designValueRefs: [],
    },
    {
      id: "details-root",
      kind: "stack",
      direction: "vertical",
      gap: 12,
      padding: 16,
      childIds: ["details-text", "home-link"],
      designValueRefs: [],
    },
    {
      id: "details-text",
      kind: "text",
      text: "详情页面",
      variant: "heading",
      designValueRefs: [],
    },
    {
      id: "home-link",
      kind: "link",
      label: "回首页",
      actionId: "go-home",
      designValueRefs: [],
    },
  ];
  await store.saveUISpec({
    projectId: PROJECT_ID,
    baseRevision: 0,
    draft,
  });
}

test.beforeAll(async () => {
  await seedProject();
});

test("P1 组件支持受控输入、状态、选项卡和链接导航", async ({ page }) => {
  await page.goto(
    `/?projectId=${PROJECT_ID}&pageId=home&viewportId=desktop&specRevision=1&designRevision=1`,
  );

  await expect(page.locator(".workspace-panel")).toHaveCount(3);

  const name = page.getByLabel("姓名").first();
  const absolute = page.getByLabel("绝对定位输入");
  const bio = page.locator(".ui-textarea textarea").first();
  const country = page.getByLabel("国家").first();
  const notify = page.getByRole("switch").first();
  const planBasic = page.getByRole("radio", { name: "基础版" });
  const planPro = page.getByRole("radio", { name: "专业版" });

  await name.fill("E2E");
  await expect(name).toHaveValue("E2E");
  await absolute.fill("Pinned");
  await expect(absolute).toHaveValue("Pinned");
  await expect(absolute).toHaveClass(/ui-input-direct/);
  await expect(
    page.locator('[data-ui-node-id="absolute-input"] span'),
  ).toHaveCount(0);
  await bio.fill("hello");
  await expect(bio).toHaveValue("hello");
  await country.selectOption("us");
  await expect(country).toHaveValue("us");
  await notify.click();
  await expect(notify).toBeChecked();
  await planPro.click();
  await expect(planPro).toBeChecked();
  await expect(planBasic).not.toBeChecked();

  await page.getByRole("tab", { name: "高级" }).click();
  await expect(page.getByText("高级面板")).toBeVisible();
  await expect(page.getByText("常规面板")).not.toBeVisible();

  await expect(page.getByText("Target Variant")).not.toBeVisible();
  await page.getByRole("button", { name: "切换 Variant" }).click();
  await expect(page.getByText("Target Variant")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "切换 Variant" }),
  ).not.toBeVisible();

  await page.getByRole("link", { name: "去详情" }).click();
  await expect(
    page.locator(".implementation-canvas"),
  ).toHaveAttribute("data-page-id", "details");
  await expect(page).toHaveURL(/pageId=details/);

  await page.getByRole("link", { name: "回首页" }).click();
  await expect(
    page.locator(".implementation-canvas"),
  ).toHaveAttribute("data-page-id", "home");
});

test("P1 禁用控件不能修改状态或获得焦点", async ({ page }) => {
  const store = new ProjectStore("data");
  const current = await store.loadUISpec(PROJECT_ID);
  const draft = structuredClone(current);
  delete (draft as { revision?: number }).revision;
  for (const node of draft.nodes) {
    if (
      node.kind === "input" ||
      node.kind === "textarea" ||
      node.kind === "select" ||
      node.kind === "switch" ||
      node.kind === "radio" ||
      node.kind === "link"
    ) {
      node.disabled = true;
    }
  }
  await store.saveUISpec({
    projectId: PROJECT_ID,
    baseRevision: 1,
    draft,
  });

  await page.goto(
    `/?projectId=${PROJECT_ID}&pageId=home&viewportId=desktop&specRevision=2&designRevision=1`,
  );

  const name = page.getByLabel("姓名").first();
  await expect(name).toBeDisabled();
  await name.evaluate((element) => element.focus());
  await page.keyboard.type("blocked");
  await expect(name).toHaveValue("");

  const link = page.getByRole("link", { name: "去详情" });
  await link.evaluate((element) => (element as HTMLAnchorElement).click());
  await expect(
    page.locator(".implementation-canvas"),
  ).toHaveAttribute("data-page-id", "home");
});
