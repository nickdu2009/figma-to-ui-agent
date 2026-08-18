import { expect, test } from "@playwright/test";
import {
  adminEmailFor,
  loginCreateAndEnter,
} from "./e2e-helpers.ts";

/**
 * 步骤 2 验证：预览壳加载、根路由渲染、重置恢复 minimalBaseSpec、
 * 运行时内置 Link 可用（catalog 不含 Link 但运行时内置）。
 */
const stackProps = {
  direction: "vertical",
  gap: "md",
  align: null,
  justify: null,
  className: null,
};

const fixtureSpec = {
  metadata: { title: { default: "Acme", template: "%s | Acme" } },
  layouts: {
    root: {
      root: "nav",
      elements: {
        nav: {
          type: "Stack",
          props: stackProps,
          children: ["homeLink", "docsLink", "slot"],
        },
        homeLink: {
          type: "Link",
          props: { href: "/" },
          children: ["homeLabel"],
        },
        homeLabel: {
          type: "Text",
          props: { text: "首页", variant: null },
          children: [],
        },
        docsLink: {
          type: "Link",
          props: { href: "/docs" },
          children: ["docsLabel"],
        },
        docsLabel: {
          type: "Text",
          props: { text: "文档", variant: null },
          children: [],
        },
        slot: { type: "Slot", props: {}, children: [] },
      },
    },
  },
  routes: {
    "/": {
      metadata: { title: "首页" },
      layout: "root",
      page: {
        root: "r1",
        elements: {
          r1: { type: "Stack", props: stackProps, children: ["h", "save"] },
          h: {
            type: "Heading",
            props: { text: "欢迎使用 Acme", level: "h1" },
            children: [],
          },
          save: {
            type: "Button",
            props: { label: "保存任务", variant: "primary", disabled: null },
            children: [],
          },
        },
      },
    },
    "/docs": {
      metadata: { title: "文档" },
      layout: "root",
      page: {
        root: "r2",
        elements: {
          r2: { type: "Stack", props: stackProps, children: ["h2"] },
          h2: {
            type: "Heading",
            props: { text: "开发文档", level: "h2" },
            children: [],
          },
        },
      },
    },
  },
};

test("preview shell: Link only changes the preview route, reset restores minimalBaseSpec", async ({
  page,
}) => {
  // The host application may itself be at an arbitrary route. Preview links
  // must not push that route into the browser's history.
  await loginCreateAndEnter(page, adminEmailFor(test.info().workerIndex), "preview-app");
  const hostUrl = page.url();

  // 预览壳加载。
  await expect(page.getByTestId("preview-panel")).toBeVisible();
  await expect(page.getByTestId("preview-revision")).toContainText(
    "revision 0",
  );

  // 应用夹具 Spec -> 根路由渲染。
  const applied = await page.evaluate(async (spec) => {
    const runtime = (
      window as unknown as {
        __previewRuntime: {
          applySource: (
            s: unknown,
          ) => Promise<{ status: string; revision?: number }>;
        };
      }
    ).__previewRuntime;
    const result = await runtime.applySource({ kind: "object", value: spec });
    return {
      status: result.status,
      revision: "revision" in result ? result.revision : -1,
    };
  }, fixtureSpec);
  expect(applied.status).toBe("committed");

  await expect(page.getByText("欢迎使用 Acme")).toBeVisible();
  await expect(page.getByTestId("preview-address")).toContainText("preview.local/");
  const styledButton = page.getByRole("button", { name: "保存任务" });
  await expect(styledButton).toHaveCSS("height", "36px");
  expect(
    await styledButton.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).borderRadius),
    ),
  ).toBeGreaterThan(0);
  await expect(page.getByTestId("preview-revision")).toContainText(
    "revision 1",
  );

  // 运行时内置 Link 导航到 /docs。
  await page.getByRole("link", { name: "文档" }).click();
  await expect(page.getByText("开发文档")).toBeVisible();
  await expect(page.getByTestId("preview-panel").locator(".preview-path")).toHaveText("/docs");
  await expect(page.getByTestId("preview-address")).toContainText("preview.local/docs");
  await expect(page.getByTestId("preview-back")).toBeEnabled();
  expect(page.url()).toBe(hostUrl);

  await page.getByTestId("preview-back").click();
  await expect(page.getByText("欢迎使用 Acme")).toBeVisible();
  await expect(page.getByTestId("preview-address")).toContainText("preview.local/");
  await expect(page.getByTestId("preview-forward")).toBeEnabled();
  expect(page.url()).toBe(hostUrl);

  await page.getByTestId("preview-forward").click();
  await expect(page.getByText("开发文档")).toBeVisible();
  await expect(page.getByTestId("preview-address")).toContainText("preview.local/docs");
  expect(page.url()).toBe(hostUrl);

  await page.getByTestId("preview-reload").click();
  await expect(page.getByText("开发文档")).toBeVisible();
  expect(page.url()).toBe(hostUrl);

  // 重置 -> minimalBaseSpec 成为新的 current（导航也会推 revision，
  // 因此断言 current 内容而不是具体 revision 数字）。
  await page.getByTestId("preview-reset").click();
  await expect(page.getByText("开发文档")).not.toBeVisible();
  const current = await page.evaluate(() => {
    const runtime = (
      window as unknown as {
        __previewRuntime: {
          getSnapshot: () => {
            current: {
              routes: Record<string, unknown>;
              metadata?: { title?: { default?: string } };
            } | null;
          };
        };
      }
    ).__previewRuntime;
    return runtime.getSnapshot().current;
  });
  expect(current).not.toBeNull();
  expect(Object.keys(current?.routes ?? {})).toHaveLength(0);
  expect(
    (current?.metadata as { title?: { default?: string } } | undefined)?.title
      ?.default,
  ).toBe("Untitled App");
});
