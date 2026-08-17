import type { NextAppSpec, NextMetadata, Spec } from "@next-app-runtime/client";

import { minimalBaseSpec } from "./minimal-base-spec";

export interface AppRouteSummary {
  path: string;
  title?: string;
  root: string;
  mainElements: string[];
}

export interface AppSummary {
  title?: string;
  routes: AppRouteSummary[];
  navigation: {
    labels: string[];
    hrefs: string[];
  };
}

function metadataTitle(title: NextMetadata["title"]): string | undefined {
  if (typeof title === "string") return title;
  if (title && typeof title === "object") {
    return title.absolute ?? title.default;
  }
  return undefined;
}

/**
 * Navigation is extracted from the runtime built-in Link elements found in
 * layout trees first and then page trees, in document order, deduplicated by
 * href. The Link label comes from its `label` prop, falling back to the href.
 */
function collectNavigation(spec: NextAppSpec): AppSummary["navigation"] {
  const labels: string[] = [];
  const hrefs: string[] = [];
  const seenHrefs = new Set<string>();
  const trees: Spec[] = [
    ...Object.values(spec.layouts ?? {}),
    ...Object.values(spec.routes).map((route) => route.page),
  ];
  for (const tree of trees) {
    for (const element of Object.values(tree.elements)) {
      if (element.type !== "Link") continue;
      const href = element.props?.href;
      if (typeof href !== "string" || seenHrefs.has(href)) continue;
      seenHrefs.add(href);
      hrefs.push(href);
      // Link 文案优先取 props.label（shadcn 形态），否则取第一个 Text 子元素
      // 的 props.text（运行时内置 Link 形态），最后回退 href。
      let label =
        typeof element.props?.label === "string" &&
        element.props.label.length > 0
          ? element.props.label
          : href;
      if (label === href) {
        for (const childKey of element.children ?? []) {
          const child = tree.elements[childKey];
          const text = child?.type === "Text" ? child.props?.text : undefined;
          if (typeof text === "string" && text.length > 0) {
            label = text;
            break;
          }
        }
      }
      labels.push(label);
    }
  }
  return { labels, hrefs };
}

/**
 * Compact structural summary of the current application, used for planning.
 * It is derived from `runtime.getSnapshot().current ?? minimalBaseSpec` and
 * is never the source of truth for the application.
 */
export function summarizeCurrentApp(
  spec: NextAppSpec | null | undefined,
): AppSummary {
  const effective = spec ?? minimalBaseSpec;
  return {
    title: metadataTitle(effective.metadata?.title),
    routes: Object.entries(effective.routes).map(([path, route]) => {
      const rootElement = route.page.elements[route.page.root];
      const mainElements = (rootElement?.children ?? [])
        .map((childKey) => route.page.elements[childKey]?.type)
        .filter((type): type is string => typeof type === "string");
      const title = metadataTitle(route.metadata?.title);
      return {
        path,
        ...(title === undefined ? {} : { title }),
        root: route.page.root,
        mainElements,
      };
    }),
    navigation: collectNavigation(effective),
  };
}
