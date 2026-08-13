import type { ResolvedMetadata } from "../router/metadata.js";

const OWNER = "next-app-runtime";
let controllerSequence = 0;

interface TitleEntry {
  order: number;
  title?: string;
}

interface DocumentTitleState {
  hostTitle: string;
  order: number;
  activeOwner: string | null;
  lastManagedTitle?: string;
  entries: Map<string, TitleEntry>;
}

const TITLE_STATES = new WeakMap<Document, DocumentTitleState>();

function releaseTitleOwnershipToHost(
  document: Document,
  state: DocumentTitleState,
): void {
  state.hostTitle = document.title;
  state.activeOwner = null;
  state.lastManagedTitle = undefined;
  for (const entry of state.entries.values()) entry.title = undefined;
}

function titleStateFor(document: Document): DocumentTitleState {
  const existing = TITLE_STATES.get(document);
  if (existing) return existing;
  const state: DocumentTitleState = {
    hostTitle: document.title,
    order: 0,
    activeOwner: null,
    entries: new Map(),
  };
  TITLE_STATES.set(document, state);
  return state;
}

function reconcileTitle(
  document: Document,
  state: DocumentTitleState,
  ownerId: string,
): void {
  const wasActiveOwner = state.activeOwner === ownerId;
  if (!wasActiveOwner) return;
  if (
    state.lastManagedTitle !== undefined &&
    document.title !== state.lastManagedTitle
  ) {
    releaseTitleOwnershipToHost(document, state);
    return;
  }
  const previous = [...state.entries.entries()]
    .filter(([, entry]) => entry.title !== undefined)
    .sort((left, right) => right[1].order - left[1].order)[0];
  if (previous?.[1].title !== undefined) {
    document.title = previous[1].title;
    state.activeOwner = previous[0];
    state.lastManagedTitle = previous[1].title;
    return;
  }
  document.title = state.hostTitle;
  state.activeOwner = null;
  state.lastManagedTitle = undefined;
}

function titleValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.absolute === "string") return record.absolute;
    if (typeof record.default === "string") return record.default;
  }
  return undefined;
}

export interface HeadController {
  apply(metadata: ResolvedMetadata): void;
  dispose(): void;
}

export function createHeadController(document: Document): HeadController {
  const ownerId = `${OWNER}-${++controllerSequence}`;
  const titleState = titleStateFor(document);
  const titleEntry: TitleEntry = { order: 0 };
  titleState.entries.set(ownerId, titleEntry);
  let disposed = false;
  const removeOwned = () => {
    for (const node of document.head.querySelectorAll(
      `[data-owner="${OWNER}"][data-runtime-owner="${ownerId}"]`,
    )) {
      node.remove();
    }
  };
  const appendMeta = (name: string, content: string, property = false) => {
    const meta = document.createElement("meta");
    meta.setAttribute(property ? "property" : "name", name);
    meta.content = content;
    meta.dataset.owner = OWNER;
    meta.dataset.runtimeOwner = ownerId;
    document.head.append(meta);
  };
  const appendLink = (rel: string, href: string) => {
    const link = document.createElement("link");
    link.rel = rel;
    link.href = href;
    link.dataset.owner = OWNER;
    link.dataset.runtimeOwner = ownerId;
    document.head.append(link);
  };
  return {
    apply(metadata) {
      if (disposed) return;
      removeOwned();
      const title = titleValue(metadata.title);
      if (title) {
        if (
          titleState.activeOwner === null ||
          document.title !== titleState.lastManagedTitle
        ) {
          releaseTitleOwnershipToHost(document, titleState);
        }
        titleEntry.title = title;
        titleEntry.order = ++titleState.order;
        document.title = title;
        titleState.activeOwner = ownerId;
        titleState.lastManagedTitle = title;
      } else if (titleEntry.title !== undefined) {
        titleEntry.title = undefined;
        reconcileTitle(document, titleState, ownerId);
      }
      if (typeof metadata.description === "string") {
        appendMeta("description", metadata.description);
      }
      if (Array.isArray(metadata.keywords)) {
        appendMeta("keywords", metadata.keywords.join(", "));
      }
      const openGraph = metadata.openGraph as Record<string, unknown> | undefined;
      const openGraphNames: Record<string, string> = {
        title: "title",
        description: "description",
        images: "image",
        type: "type",
        url: "url",
        siteName: "site_name",
        locale: "locale",
      };
      for (const [key, value] of Object.entries(openGraph ?? {})) {
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
          if (typeof item === "string") appendMeta(`og:${openGraphNames[key]}`, item, true);
        }
      }
      const twitter = metadata.twitter as Record<string, unknown> | undefined;
      const twitterNames: Record<string, string> = { images: "image" };
      for (const [key, value] of Object.entries(twitter ?? {})) {
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
          if (typeof item === "string") appendMeta(`twitter:${twitterNames[key] ?? key}`, item);
        }
      }
      if (typeof metadata.robots === "string") appendMeta("robots", metadata.robots);
      if (metadata.robots && typeof metadata.robots === "object") {
        const robots = metadata.robots as { index?: boolean; follow?: boolean };
        appendMeta(
          "robots",
          `${robots.index === false ? "noindex" : "index"},${robots.follow === false ? "nofollow" : "follow"}`,
        );
      }
      const alternates = metadata.alternates as { canonical?: string } | undefined;
      if (alternates?.canonical) appendLink("canonical", alternates.canonical);
      const icons = metadata.icons;
      if (typeof icons === "string") appendLink("icon", icons);
      if (icons && typeof icons === "object") {
        const values = icons as { icon?: string; apple?: string; shortcut?: string };
        if (values.icon) appendLink("icon", values.icon);
        if (values.apple) appendLink("apple-touch-icon", values.apple);
        if (values.shortcut) appendLink("shortcut icon", values.shortcut);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeOwned();
      titleState.entries.delete(ownerId);
      reconcileTitle(document, titleState, ownerId);
      if (titleState.entries.size === 0) TITLE_STATES.delete(document);
    },
  };
}
