import { expect, test } from "@playwright/test";

const storageKey = "next-app-runtime:website-builder:spec:v1";
const localEvent = "next-app-runtime:website-builder:spec-change";
const defaultHeadline = "Build the future with Acme";

async function editVisualJsonHeadline(
  page: import("@playwright/test").Page,
  current: string,
  next: string,
) {
  await page.getByText(current, { exact: true }).first().dblclick();
  const editor = page.locator('input[placeholder="<value>"]');
  await expect(editor).toHaveValue(current);
  await editor.fill(next);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: next })).toBeVisible();
}

async function clearTestStorage(page: import("@playwright/test").Page) {
  await page.evaluate(({ key, eventName }) => {
    localStorage.removeItem(key);
    window.dispatchEvent(new Event(eventName));
  }, { key: storageKey, eventName: localEvent });
}

const editedSpec = {
  metadata: { title: "Stored Site", description: "Stored description" },
  routes: {
    "/": {
      page: {
        root: "hero",
        elements: {
          hero: {
            type: "Hero",
            props: {
              headline: "Edited Brand",
              description: "Synchronized from browser storage",
              primaryCta: null,
              secondaryCta: null,
              badge: null,
              variant: "centered",
            },
          },
        },
      },
    },
  },
};

const navigationSpec = {
  routes: {
    "/": {
      page: {
        root: "header",
        elements: {
          header: {
            type: "Header",
            props: {
              brand: "Navigation Test",
              links: [
                { label: "Builder", href: "/builder" },
                { label: "Unsafe", href: "JaVa\nScRiPt:window.__unsafeExampleExecuted = true" },
              ],
              variant: "simple",
            },
          },
        },
      },
    },
  },
};

test("renders the complete default website and navigates all pages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Build the future with Acme" })).toBeVisible();
  await expect(page).toHaveTitle("Home | Acme Inc");
  await page.evaluate(() => Object.assign(window, { __runtimeNavigationMarker: "preserved" }));

  await page.getByRole("link", { name: "About" }).first().click();
  await expect(page).toHaveURL(/\/about$/u);
  await expect(page.getByRole("heading", { name: "About Acme Inc" })).toBeVisible();
  await expect(page).toHaveTitle("About | Acme Inc");
  expect(await page.evaluate(() => (window as unknown as { __runtimeNavigationMarker?: string }).__runtimeNavigationMarker))
    .toBe("preserved");

  await page.getByRole("link", { name: "Contact" }).first().click();
  await expect(page).toHaveURL(/\/contact$/u);
  await expect(page.getByRole("heading", { name: "Get in Touch" })).toBeVisible();
  await expect(page).toHaveTitle("Contact | Acme Inc");

  await page.goBack();
  await expect(page).toHaveURL(/\/about$/u);
  await expect(page).toHaveTitle("About | Acme Inc");
  await page.goForward();
  await expect(page).toHaveURL(/\/contact$/u);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Get in Touch" })).toBeVisible();
});

test("edits through Visual JSON, persists, opens the website and synchronizes tabs", async ({ context }) => {
  const builder = await context.newPage();
  let website: import("@playwright/test").Page | null = null;
  await builder.goto("/builder");
  await clearTestStorage(builder);
  await builder.reload();
  try {
    await expect(builder.getByText("Next Website Builder", { exact: true })).toBeVisible();
    await expect(builder).toHaveTitle("Next Website Builder | @next-app-runtime/client");
    await expect(builder.getByText("spec.json", { exact: true })).toBeVisible();
    await expect(builder.getByTitle("Hide sidebar")).toBeVisible();
    await expect(builder.getByPlaceholder("/")).toHaveValue("/");
    for (const route of ["Home", "About", "Contact"]) {
      await expect(builder.getByText(route, { exact: true }).first()).toBeVisible();
    }

    await builder.getByRole("link", { name: "About" }).first().click();
    await expect(builder).toHaveURL(/\/builder$/u);
    await expect(builder.getByPlaceholder("/")).toHaveValue("/about");
    await expect(builder.getByRole("heading", { name: "About Acme Inc" })).toBeVisible();
    await builder.getByRole("link", { name: "Home" }).first().click();
    await expect(builder.getByPlaceholder("/")).toHaveValue("/");

    const firstEdit = "Edited through Visual JSON";
    await editVisualJsonHeadline(builder, defaultHeadline, firstEdit);
    await expect.poll(() => builder.evaluate((key) => localStorage.getItem(key), storageKey))
      .toContain(firstEdit);
    await builder.reload();
    await expect(builder.getByRole("heading", { name: firstEdit })).toBeVisible();

    const opened = context.waitForEvent("page");
    await builder.getByRole("link", { name: "View Website" }).click();
    website = await opened;
    await website.waitForLoadState("domcontentloaded");
    await expect(website.getByRole("heading", { name: firstEdit })).toBeVisible();

    const secondEdit = "Synchronized through storage event";
    await editVisualJsonHeadline(builder, firstEdit, secondEdit);
    await expect.poll(() => builder.evaluate((key) => localStorage.getItem(key), storageKey))
      .toContain(secondEdit);
    await expect(website.getByRole("heading", { name: secondEdit })).toBeVisible();

    await website.evaluate(() => Object.assign(window, { __runtimeNavigationMarker: "preserved" }));
    await website.getByRole("link", { name: "About" }).first().click();
    await expect(website).toHaveURL(/\/about$/u);
    expect(await website.evaluate(() => (
      window as unknown as { __runtimeNavigationMarker?: string }
    ).__runtimeNavigationMarker)).toBe("preserved");
    await website.getByRole("link", { name: "Contact" }).first().click();
    await expect(website).toHaveURL(/\/contact$/u);
    await website.goBack();
    await expect(website).toHaveURL(/\/about$/u);
    await website.goForward();
    await expect(website).toHaveURL(/\/contact$/u);
    await website.reload();
    await expect(website.getByRole("heading", { name: "Get in Touch" })).toBeVisible();
  } finally {
    if (website && !website.isClosed()) await clearTestStorage(website);
    if (!builder.isClosed()) await clearTestStorage(builder);
  }
});

test("synchronizes successful storage writes and preserves the last valid runtime", async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/"), second.goto("/")]);
  try {
    await first.evaluate(({ key, eventName, spec }) => {
      localStorage.setItem(key, JSON.stringify(spec));
      window.dispatchEvent(new Event(eventName));
    }, { key: storageKey, eventName: localEvent, spec: editedSpec });

    await expect(first.getByRole("heading", { name: "Edited Brand" })).toBeVisible();
    await expect(second.getByRole("heading", { name: "Edited Brand" })).toBeVisible();
    await expect(second).toHaveTitle("Stored Site");

    await first.evaluate(({ key, eventName }) => {
      localStorage.setItem(key, "{invalid");
      window.dispatchEvent(new Event(eventName));
    }, { key: storageKey, eventName: localEvent });

    await expect(first.locator('[data-storage-error="stored_spec_parse_failed"]')).toBeVisible();
    await expect(second.locator('[data-storage-error="stored_spec_parse_failed"]')).toBeVisible();
    await expect(first.getByRole("heading", { name: "Edited Brand" })).toBeVisible();
    await expect(second.getByRole("heading", { name: "Edited Brand" })).toBeVisible();
  } finally {
    await clearTestStorage(first);
    await clearTestStorage(second);
  }
});

test("keeps the latest invalid storage error when an earlier valid apply settles", async ({ page }) => {
  await page.goto("/");
  await clearTestStorage(page);
  try {
    await page.evaluate(({ key, eventName, spec }) => {
      localStorage.setItem(key, JSON.stringify(spec));
      window.dispatchEvent(new Event(eventName));
      localStorage.setItem(key, "{invalid");
      window.dispatchEvent(new Event(eventName));
    }, { key: storageKey, eventName: localEvent, spec: editedSpec });

    await expect(page.locator('[data-storage-error="stored_spec_parse_failed"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Edited Brand" })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe("{invalid");
  } finally {
    await clearTestStorage(page);
  }
});

test("keeps contract-invalid candidates editable while the last valid preview stays active", async ({ page }) => {
  await page.goto("/builder");
  await clearTestStorage(page);
  await page.reload();
  try {
    await expect(page.getByRole("heading", { name: defaultHeadline })).toBeVisible();
    await page.evaluate(({ key, eventName }) => {
      localStorage.setItem(key, JSON.stringify({ routes: null }));
      window.dispatchEvent(new Event(eventName));
    }, { key: storageKey, eventName: localEvent });

    await expect(page.locator('[data-storage-error="stored_spec_contract_invalid"]')).toBeVisible();
    await expect(page.getByText("routes", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("null", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: defaultHeadline })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey))
      .toBe(JSON.stringify({ routes: null }));

    await page.evaluate(({ key, eventName, spec }) => {
      const candidate = structuredClone(spec);
      candidate.routes["/"].page.root = "missing";
      localStorage.setItem(key, JSON.stringify(candidate));
      window.dispatchEvent(new Event(eventName));
    }, { key: storageKey, eventName: localEvent, spec: editedSpec });
    await expect(page.locator('[data-storage-error="references_invalid"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: defaultHeadline })).toBeVisible();
  } finally {
    await clearTestStorage(page);
  }
});

test("switches between website and builder through History and blocks unsafe website anchors", async ({ page }) => {
  await page.goto("/");
  await clearTestStorage(page);
  try {
    await page.evaluate(({ key, eventName, spec }) => {
      localStorage.setItem(key, JSON.stringify(spec));
      window.dispatchEvent(new Event(eventName));
      Object.assign(window, {
        __unsafeExampleExecuted: false,
        __rootMarker: "preserved",
      });
    }, { key: storageKey, eventName: localEvent, spec: navigationSpec });

    await page.getByRole("link", { name: "Unsafe" }).dispatchEvent("click");
    expect(await page.evaluate(() => (
      window as unknown as { __unsafeExampleExecuted: boolean }
    ).__unsafeExampleExecuted)).toBe(false);
    await expect(page).toHaveURL(/\/$/u);
    await page.getByRole("link", { name: "Unsafe" }).dispatchEvent("click", { ctrlKey: true });
    expect(await page.evaluate(() => (
      window as unknown as { __unsafeExampleExecuted: boolean }
    ).__unsafeExampleExecuted)).toBe(false);

    await page.getByRole("link", { name: "Builder" }).click();
    await expect(page).toHaveURL(/\/builder$/u);
    await expect(page.getByText("Next Website Builder", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (
      window as unknown as { __rootMarker?: string }
    ).__rootMarker)).toBe("preserved");

    await page.goBack();
    await expect(page).toHaveURL(/\/$/u);
    await expect(page.getByText("Navigation Test", { exact: true })).toBeVisible();
  } finally {
    await clearTestStorage(page);
  }
});
