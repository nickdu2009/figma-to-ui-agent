import type { DesignBundle } from "../design-bundle/schema.ts";

const MAX_PAGE_TITLE_LENGTH = 128;

export type ViewportRole = "desktop" | "mobile" | "tablet" | "unknown";

export interface StaticPagePlan {
  readonly pageId: string;
  readonly sourcePageId: string;
  readonly sourceRootNodeId?: string;
  readonly path: string;
  readonly title: string;
  readonly viewportRole: ViewportRole;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly warnings: Array<{ readonly code: string; readonly detail: string }>;
}

function safeId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "page";
}

function classifyViewportRole(
  width: number,
  height: number,
): ViewportRole {
  const min = Math.min(width, height);
  const max = Math.max(width, height);
  if (max < 600 || (min < 420 && max < 900)) {
    return "mobile";
  }
  if (max <= 1024 || (min < 800 && max <= 1366)) {
    return "tablet";
  }
  if (width >= 1024 && height >= 600) {
    return "desktop";
  }
  return "unknown";
}

function rootBounds(
  page: DesignBundle["pages"][number],
): StaticPagePlan["bounds"] | undefined {
  const rootNode = page.nodes.find(
    (node) => node.id === page.rootNodeIds[0],
  );
  if (!rootNode?.bounds) {
    return undefined;
  }
  return rootNode.bounds;
}

function pageBounds(
  page: DesignBundle["pages"][number],
): StaticPagePlan["bounds"] {
  const root = rootBounds(page);
  if (root) {
    return root;
  }
  return {
    x: 0,
    y: 0,
    width: page.width,
    height: page.height,
  };
}

export interface PageMappingResult {
  readonly pages: StaticPagePlan[];
  readonly entryPageId: string | undefined;
  readonly warnings: Array<{ readonly code: string; readonly detail: string }>;
}

export function mapStaticPages(
  bundle: DesignBundle,
): PageMappingResult {
  const warnings: Array<{ code: string; detail: string }> = [];
  const slugCounts = new Map<string, number>();
  const usedPageIds = new Set<string>();
  const usedPaths = new Set<string>();

  if (bundle.pages.length === 0) {
    warnings.push({
      code: "no_pages_in_bundle",
      detail: "DesignBundle 没有页面，无法生成静态 UISpec",
    });
    return { pages: [], entryPageId: undefined, warnings };
  }

  const pages: StaticPagePlan[] = [];

  for (const page of bundle.pages) {
    const pageWarnings: Array<{ code: string; detail: string }> = [];

    if (!page.width || !page.height) {
      pageWarnings.push({
        code: "page_dimensions_missing",
        detail: `页面 ${page.id} 缺少有效尺寸，跳过`,
      });
      warnings.push(...pageWarnings);
      continue;
    }

    if (page.rootNodeIds.length === 0) {
      pageWarnings.push({
        code: "page_root_missing",
        detail: `页面 ${page.id} 没有根节点，跳过`,
      });
      warnings.push(...pageWarnings);
      continue;
    }

    const rootNode = page.nodes.find(
      (node) => node.id === page.rootNodeIds[0],
    );
    if (!rootNode || !rootNode.visible) {
      pageWarnings.push({
        code: "page_root_hidden",
        detail: `页面 ${page.id} 根节点不存在或隐藏，跳过`,
      });
      warnings.push(...pageWarnings);
      continue;
    }

    const bounds = pageBounds(page);
    if (bounds.width <= 0 || bounds.height <= 0) {
      pageWarnings.push({
        code: "page_bounds_zero",
        detail: `页面 ${page.id} 根节点尺寸为零，跳过`,
      });
      warnings.push(...pageWarnings);
      continue;
    }

    const baseSlug = safeId(page.name || page.id);
    const slugCount = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, slugCount + 1);
    const slug = slugCount === 0 ? baseSlug : `${baseSlug}-${slugCount + 1}`;
    let path = baseSlug === "" ? "/" : `/${slug}`;
    let pathDedupe = 1;
    while (usedPaths.has(path)) {
      path = `/${slug}-${pathDedupe}`;
      pathDedupe += 1;
    }

    let pageId = safeId(page.name || page.id);
    let dedupe = 1;
    while (usedPageIds.has(pageId)) {
      pageId = `${safeId(page.name || page.id)}-${dedupe}`;
      dedupe += 1;
    }
    usedPageIds.add(pageId);
    usedPaths.add(path);

    const title = page.name.slice(0, MAX_PAGE_TITLE_LENGTH);

    pages.push({
      pageId,
      sourcePageId: page.id,
      sourceRootNodeId: rootNode.id,
      path,
      title,
      viewportRole: classifyViewportRole(bounds.width, bounds.height),
      bounds,
      warnings: pageWarnings,
    });
  }

  const entryPageId = pages[0]?.pageId;

  if (pages.length === 0) {
    warnings.push({
      code: "no_renderable_pages",
      detail: "DesignBundle 中没有可渲染页面",
    });
  }

  return { pages, entryPageId, warnings };
}
