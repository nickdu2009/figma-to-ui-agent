import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FigmaImageDownloader } from "../../../src/figma/assets.ts";
import { FigmaInspector } from "../../../src/figma/inspector.ts";
import {
  FigmaRestClient,
  type FigmaFetch,
} from "../../../src/figma/rest-client.ts";
import { ProjectStore } from "../../../src/project-store/store.ts";
import { createFigmaFileResponseFixture } from "../../fixtures/figma/file-response.ts";
import { createPngBytes } from "../../fixtures/images.ts";

const FILE_KEY = "abcdefgh123";
const temporaryRoots: string[] = [];

function jsonResponse(
  value: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function imageResponse(bytes: Uint8Array): Response {
  return new Response(Uint8Array.from(bytes).buffer, {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("FigmaInspector mock REST 纵向切片", () => {
  it("Variables 403 时仍发布完整 DesignBundle，核心失败不覆盖旧修订", async () => {
    const root = await mkdtemp(join(tmpdir(), "figma-inspector-"));
    temporaryRoots.push(root);
    const store = new ProjectStore(root);
    let failCore = false;
    const fetchImpl = vi.fn<FigmaFetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.figma.com") {
        if (url.pathname === `/v1/files/${FILE_KEY}`) {
          return failCore
            ? new Response("private upstream body", { status: 503 })
            : jsonResponse(createFigmaFileResponseFixture());
        }
        if (url.pathname === `/v1/files/${FILE_KEY}/images`) {
          return jsonResponse({
            meta: {
              images: {
                "image-source-1":
                  "https://s3-alpha.figma.com/assets/hero.png?signature=private",
              },
            },
          });
        }
        if (url.pathname === `/v1/images/${FILE_KEY}`) {
          const ids = url.searchParams.get("ids")?.split(",") ?? [];
          return jsonResponse({
            images: Object.fromEntries(
              ids.map((id) => [
                id,
                `https://s3-alpha.figma.com/screenshots/${id.replaceAll(
                  ":",
                  "-",
                )}.png?signature=private`,
              ]),
            ),
          });
        }
        if (
          url.pathname ===
          `/v1/files/${FILE_KEY}/variables/local`
        ) {
          return new Response("scope details must stay private", {
            status: 403,
          });
        }
      }
      if (url.pathname === "/assets/hero.png") {
        return imageResponse(createPngBytes(640, 480));
      }
      if (url.pathname === "/screenshots/1-1.png") {
        return imageResponse(createPngBytes(1440, 900));
      }
      if (url.pathname === "/screenshots/2-1.png") {
        return imageResponse(createPngBytes(1024, 768));
      }
      if (url.pathname === "/screenshots/1-3.png") {
        return imageResponse(createPngBytes(640, 480));
      }
      if (url.pathname === "/screenshots/1-6.png") {
        return imageResponse(createPngBytes(520, 460));
      }
      return new Response("unexpected", { status: 404 });
    });
    const restClient = new FigmaRestClient({
      token: "private-token",
      fetchImpl,
      maxRetries: 0,
    });
    const inspector = new FigmaInspector({
      restClient,
      imageDownloader: new FigmaImageDownloader({
        projectStore: store,
        fetchImpl,
      }),
      projectStore: store,
      now: () => new Date("2026-07-23T10:00:00.000Z"),
    });
    const input = {
      schemaVersion: "1",
      projectId: "demo-project",
      figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Fixture`,
    };

    const output = await inspector.inspect(input);
    expect(output).toMatchObject({
      projectId: "demo-project",
      designBundleRevision: 1,
      variables: {
        status: "unavailable_optional",
        reasonCode: "unknown",
      },
      pages: [
        { id: "1:1", name: "Home", width: 1440, height: 900 },
        {
          id: "2:1",
          name: "Settings",
          width: 1024,
          height: 768,
        },
      ],
    });
    expect(output.warnings).toContainEqual({
      code: "variables_unavailable_optional",
      detail: "Variables 可选能力不可用：unknown",
    });

    const saved = await store.loadDesignBundle("demo-project");
    expect(saved.revision).toBe(1);
    expect(saved.assets).toHaveLength(1);
    expect(saved.screenshots).toHaveLength(4);
    const blob = saved.pages[0]!.nodes.find(
      (node) => node.id === "1:6",
    );
    const blobSourceHash = saved.provenance.find(
      (entry) =>
        entry.entityKind === "node" &&
        entry.entityId === blob?.id,
    )?.sourceIdHash;
    expect(blob).toMatchObject({
      kind: "vector",
      name: "Vector layer",
    });
    expect(saved.provenance).toContainEqual(
      expect.objectContaining({
        entityKind: "screenshot",
        origin: "figma_node",
        sourceIdHash: blobSourceHash,
      }),
    );
    expect(saved.designValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: expect.stringMatching(/^color\.fill\.[a-f0-9]{8}$/),
          origin: "inferred",
          kind: "color",
        }),
        expect.objectContaining({
          name: "number.binding.1",
          value: 32,
          origin: "inferred_from_binding",
        }),
      ]),
    );
    const bindingValue = saved.designValues.find(
      (value) => value.name === "number.binding.1",
    );
    expect(
      saved.pages[0]!.nodes.find((node) => node.id === "1:2")
        ?.designValueRefs,
    ).toEqual([bindingValue?.id]);
    const serialized = JSON.stringify(saved);
    expect(serialized).not.toContain(FILE_KEY);
    expect(serialized).not.toContain("VariableID:");
    expect(serialized).not.toContain("signature=private");
    expect(serialized).not.toContain("private-token");

    failCore = true;
    await expect(inspector.inspect(input)).rejects.toMatchObject({
      name: "FigmaRestError",
      code: "http_error",
      status: 503,
    });
    await expect(
      store.loadDesignBundle("demo-project"),
    ).resolves.toEqual(saved);
  });

  it("显式目标节点时优先读取 nodes 端点，避免全文件响应过大", async () => {
    const root = await mkdtemp(join(tmpdir(), "figma-inspector-"));
    temporaryRoots.push(root);
    const store = new ProjectStore(root);
    const fetchImpl = vi.fn<FigmaFetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.figma.com") {
        if (url.pathname === `/v1/files/${FILE_KEY}`) {
          return new Response("oversized full file", {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-length": String(25 * 1024 * 1024),
            },
          });
        }
        if (url.pathname === `/v1/files/${FILE_KEY}/nodes`) {
          expect(url.searchParams.get("ids")).toBe("1:1");
          const fixture = createFigmaFileResponseFixture();
          const document = fixture.document as {
            children: Array<{
              children: Array<Record<string, unknown>>;
            }>;
          };
          const target = document.children[0]!.children[0]!;
          return jsonResponse({
            nodes: {
              "1:1": {
                document: target,
                components: fixture.components,
                componentSets: fixture.componentSets,
                styles: fixture.styles,
              },
            },
          });
        }
        if (url.pathname === `/v1/files/${FILE_KEY}/images`) {
          return jsonResponse({
            meta: {
              images: {
                "image-source-1":
                  "https://s3-alpha.figma.com/assets/hero.png?signature=private",
              },
            },
          });
        }
        if (url.pathname === `/v1/images/${FILE_KEY}`) {
          return jsonResponse({
            images: {
              "1:1":
                "https://s3-alpha.figma.com/screenshots/1-1.png?signature=private",
            },
          });
        }
        if (
          url.pathname ===
          `/v1/files/${FILE_KEY}/variables/local`
        ) {
          return new Response("scope details must stay private", {
            status: 403,
          });
        }
      }
      if (url.pathname === "/assets/hero.png") {
        return imageResponse(createPngBytes(640, 480));
      }
      if (url.pathname === "/screenshots/1-1.png") {
        return imageResponse(createPngBytes(375, 812));
      }
      return new Response("unexpected", { status: 404 });
    });
    const restClient = new FigmaRestClient({
      token: "private-token",
      fetchImpl,
      maxRetries: 0,
    });
    const inspector = new FigmaInspector({
      restClient,
      imageDownloader: new FigmaImageDownloader({
        projectStore: store,
        fetchImpl,
      }),
      projectStore: store,
      now: () => new Date("2026-07-24T10:00:00.000Z"),
    });

    const output = await inspector.inspect({
      schemaVersion: "1",
      projectId: "targeted-project",
      figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Fixture?node-id=1-1`,
      targetNodes: ["1:1"],
    });

    expect(output.pages).toEqual([
      { id: "1:1", name: "Home", width: 1440, height: 900 },
    ]);
    const apiPaths = fetchImpl.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.hostname === "api.figma.com")
      .map((url) => url.pathname);
    expect(apiPaths).not.toContain(`/v1/files/${FILE_KEY}`);
    expect(apiPaths).toContain(`/v1/files/${FILE_KEY}/nodes`);
    const saved = await store.loadDesignBundle("targeted-project");
    expect(saved.source.targetNodeIds).toEqual(["1:1"]);
    expect(saved.pages).toHaveLength(1);
    expect(JSON.stringify(saved)).not.toContain("signature=private");
  });

  it("显式目标节点含 prototype destination 时追加读取目标节点", async () => {
    const root = await mkdtemp(join(tmpdir(), "figma-inspector-"));
    temporaryRoots.push(root);
    const store = new ProjectStore(root);
    const nodesRequests: string[] = [];
    const fetchImpl = vi.fn<FigmaFetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.figma.com") {
        if (url.pathname === `/v1/files/${FILE_KEY}/nodes`) {
          const ids = url.searchParams.get("ids") ?? "";
          nodesRequests.push(ids);
          const fixture = createFigmaFileResponseFixture();
          const document = fixture.document as {
            children: Array<{
              children: Array<Record<string, unknown>>;
            }>;
          };
          const home = document.children[0]!.children[0]!;
          const settings = document.children[1]!.children[0]!;
          home.interactions = [
            {
              trigger: { type: "ON_CLICK" },
              actions: [
                {
                  type: "NODE",
                  navigation: "CHANGE_TO",
                  destinationId: "2:1",
                },
              ],
            },
          ];
          return jsonResponse({
            nodes:
              ids === "1:1"
                ? {
                    "1:1": {
                      document: home,
                      components: fixture.components,
                      componentSets: fixture.componentSets,
                      styles: fixture.styles,
                    },
                  }
                : {
                    "2:1": {
                      document: settings,
                      components: fixture.components,
                      componentSets: fixture.componentSets,
                      styles: fixture.styles,
                    },
                  },
          });
        }
        if (url.pathname === `/v1/files/${FILE_KEY}/images`) {
          return jsonResponse({
            meta: {
              images: {
                "image-source-1":
                  "https://s3-alpha.figma.com/assets/hero.png?signature=private",
              },
            },
          });
        }
        if (url.pathname === `/v1/images/${FILE_KEY}`) {
          const ids = url.searchParams.get("ids")?.split(",") ?? [];
          return jsonResponse({
            images: Object.fromEntries(
              ids.map((id) => [
                id,
                `https://s3-alpha.figma.com/screenshots/${id.replaceAll(
                  ":",
                  "-",
                )}.png?signature=private`,
              ]),
            ),
          });
        }
        if (
          url.pathname ===
          `/v1/files/${FILE_KEY}/variables/local`
        ) {
          return new Response("scope details must stay private", {
            status: 403,
          });
        }
      }
      if (url.pathname === "/assets/hero.png") {
        return imageResponse(createPngBytes(640, 480));
      }
      if (url.pathname.startsWith("/screenshots/")) {
        return imageResponse(createPngBytes(144, 144));
      }
      return new Response("unexpected", { status: 404 });
    });
    const inspector = new FigmaInspector({
      restClient: new FigmaRestClient({
        token: "private-token",
        fetchImpl,
        maxRetries: 0,
      }),
      imageDownloader: new FigmaImageDownloader({
        projectStore: store,
        fetchImpl,
      }),
      projectStore: store,
      now: () => new Date("2026-07-30T09:32:00.000Z"),
    });

    await inspector.inspect(
      {
        schemaVersion: "1",
        projectId: "targeted-prototype-project",
        figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Fixture?node-id=1-1`,
      },
      undefined,
      { variablesMode: "disabled_restricted_live" },
    );

    expect(nodesRequests).toEqual(["1:1", "2:1"]);
    const saved = await store.loadDesignBundle(
      "targeted-prototype-project",
    );
    expect(saved.source.targetNodeIds).toEqual(["1:1"]);
    expect(saved.pages.flatMap((page) => page.nodes.map((node) => node.id))).toEqual(
      expect.arrayContaining(["1:1", "2:1"]),
    );
    expect(
      saved.pages
        .flatMap((page) => page.nodes)
        .find((node) => node.id === "1:1")?.prototypeInteractions,
    ).toContainEqual(
      expect.objectContaining({
        navigation: "CHANGE_TO",
        destinationId: "2:1",
      }),
    );
  });

  it("显式目标节点为 CANVAS 时不会与内部包装节点冲突", async () => {
    const root = await mkdtemp(join(tmpdir(), "figma-inspector-"));
    temporaryRoots.push(root);
    const store = new ProjectStore(root);
    const fetchImpl = vi.fn<FigmaFetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.figma.com") {
        if (url.pathname === `/v1/files/${FILE_KEY}`) {
          return new Response("oversized full file", {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-length": String(25 * 1024 * 1024),
            },
          });
        }
        if (url.pathname === `/v1/files/${FILE_KEY}/nodes`) {
          expect(url.searchParams.get("ids")).toBe("0:1");
          const fixture = createFigmaFileResponseFixture();
          const document = fixture.document as {
            children: Array<Record<string, unknown>>;
          };
          return jsonResponse({
            nodes: {
              "0:1": {
                document: document.children[0],
                components: fixture.components,
                componentSets: fixture.componentSets,
                styles: fixture.styles,
              },
            },
          });
        }
        if (url.pathname === `/v1/files/${FILE_KEY}/images`) {
          return jsonResponse({
            meta: {
              images: {
                "image-source-1":
                  "https://s3-alpha.figma.com/assets/hero.png?signature=private",
              },
            },
          });
        }
        if (url.pathname === `/v1/images/${FILE_KEY}`) {
          return jsonResponse({
            images: {
              "1:1":
                "https://s3-alpha.figma.com/screenshots/1-1.png?signature=private",
            },
          });
        }
        if (
          url.pathname ===
          `/v1/files/${FILE_KEY}/variables/local`
        ) {
          return new Response("scope details must stay private", {
            status: 403,
          });
        }
      }
      if (url.pathname === "/assets/hero.png") {
        return imageResponse(createPngBytes(640, 480));
      }
      if (url.pathname === "/screenshots/1-1.png") {
        return imageResponse(createPngBytes(1440, 900));
      }
      return new Response("unexpected", { status: 404 });
    });
    const inspector = new FigmaInspector({
      restClient: new FigmaRestClient({
        token: "private-token",
        fetchImpl,
        maxRetries: 0,
      }),
      imageDownloader: new FigmaImageDownloader({
        projectStore: store,
        fetchImpl,
      }),
      projectStore: store,
      now: () => new Date("2026-07-24T11:00:00.000Z"),
    });

    const output = await inspector.inspect({
      schemaVersion: "1",
      projectId: "targeted-canvas-project",
      figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Fixture?node-id=0-1`,
    });

    expect(output.pages).toEqual([
      { id: "1:1", name: "Home", width: 1440, height: 900 },
    ]);
    const saved = await store.loadDesignBundle(
      "targeted-canvas-project",
    );
    expect(saved.source.targetNodeIds).toEqual(["0:1"]);
    expect(saved.pages[0]!.id).toBe("1:1");
    expect(saved.pages[0]!.rootNodeIds).toEqual(["1:1"]);
    expect(saved.pages[0]!.nodes.map((node) => node.id)).toContain(
      "1:1",
    );
    expect(saved.warnings).toContainEqual({
      code: "canvas_target_expanded_to_child_pages",
      entityId: "0:1",
      detail:
        "显式 CANVAS 目标已展开为可见顶层子节点，避免把整张 Figma 说明画布当作单页参考图",
    });
  });

  it("视觉层渲染按结构优先级选择而不是按文档顺序截断", async () => {
    const root = await mkdtemp(join(tmpdir(), "figma-inspector-"));
    temporaryRoots.push(root);
    const store = new ProjectStore(root);
    const fixture = createFigmaFileResponseFixture();
    const document = fixture.document as {
      children: Array<{
        children: Array<{
          children?: unknown[];
        }>;
      }>;
    };
    const frameChildren = document.children[0]!.children[0]!.children!;
    for (let index = 0; index < 85; index += 1) {
      frameChildren.push({
        id: `1:${100 + index}`,
        name: "Decorative background",
        type: "VECTOR",
        absoluteBoundingBox: {
          x: index,
          y: index,
          width: 72,
          height: 72,
        },
        fills: [
          {
            type: "SOLID",
            color: { r: 0.9, g: 0.9, b: 0.9 },
          },
        ],
      });
    }
    frameChildren.push({
      id: "1:999",
      name: "Layer 99",
      type: "VECTOR",
      absoluteBoundingBox: {
        x: 240,
        y: 160,
        width: 96,
        height: 96,
      },
      opacity: 0.7,
      blendMode: "MULTIPLY",
      effects: [{ type: "DROP_SHADOW", visible: true }],
      fills: [
        {
          type: "SOLID",
          color: { r: 0.2, g: 0.3, b: 0.4 },
        },
      ],
    });

    const imageRenderIds: string[][] = [];
    const fetchImpl = vi.fn<FigmaFetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.figma.com") {
        if (url.pathname === `/v1/files/${FILE_KEY}`) {
          return jsonResponse(fixture);
        }
        if (url.pathname === `/v1/files/${FILE_KEY}/nodes`) {
          expect(url.searchParams.get("ids")).toBe("1:1");
          const target = document.children[0]!.children[0]!;
          return jsonResponse({
            nodes: {
              "1:1": {
                document: target,
                components: fixture.components,
                componentSets: fixture.componentSets,
                styles: fixture.styles,
              },
            },
          });
        }
        if (url.pathname === `/v1/files/${FILE_KEY}/images`) {
          return jsonResponse({
            meta: {
              images: {
                "image-source-1":
                  "https://s3-alpha.figma.com/assets/hero.png?signature=private",
              },
            },
          });
        }
        if (url.pathname === `/v1/images/${FILE_KEY}`) {
          const ids = url.searchParams.get("ids")?.split(",") ?? [];
          imageRenderIds.push(ids);
          return jsonResponse({
            images: Object.fromEntries(
              ids.map((id) => [
                id,
                `https://s3-alpha.figma.com/screenshots/${id.replaceAll(
                  ":",
                  "-",
                )}.png?signature=private`,
              ]),
            ),
          });
        }
        if (
          url.pathname ===
          `/v1/files/${FILE_KEY}/variables/local`
        ) {
          return new Response("scope details must stay private", {
            status: 403,
          });
        }
      }
      if (url.pathname === "/assets/hero.png") {
        return imageResponse(createPngBytes(640, 480));
      }
      if (url.pathname.startsWith("/screenshots/")) {
        return imageResponse(createPngBytes(144, 144));
      }
      return new Response("unexpected", { status: 404 });
    });
    const inspector = new FigmaInspector({
      restClient: new FigmaRestClient({
        token: "private-token",
        fetchImpl,
        maxRetries: 0,
      }),
      imageDownloader: new FigmaImageDownloader({
        projectStore: store,
        fetchImpl,
      }),
      projectStore: store,
      now: () => new Date("2026-07-24T11:30:00.000Z"),
    });

    await inspector.inspect({
      schemaVersion: "1",
      projectId: "visual-priority-project",
      figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Fixture?node-id=1-1`,
      targetNodes: ["1:1"],
    });

    const visualRenderIds = imageRenderIds.find((ids) =>
      ids.includes("1:999"),
    );
    expect(visualRenderIds).toBeDefined();
    expect(visualRenderIds!.length).toBeLessThanOrEqual(100);
    expect(visualRenderIds).toContain("1:999");
    if (visualRenderIds!.includes("1:100")) {
      expect(visualRenderIds!.indexOf("1:999")).toBeLessThan(
        visualRenderIds!.indexOf("1:100"),
      );
    }
    const saved = await store.loadDesignBundle("visual-priority-project");
    const criticalSourceHash = saved.provenance.find(
      (entry) =>
        entry.entityKind === "node" &&
        entry.entityId === "1:999",
    )?.sourceIdHash;
    expect(saved.provenance).toContainEqual(
      expect.objectContaining({
        entityKind: "screenshot",
        sourceIdHash: criticalSourceHash,
      }),
    );
  });

  it("variablesMode=disabled_restricted_live 跳过 getLocalVariables 调用", async () => {
    const root = await mkdtemp(join(tmpdir(), "figma-inspector-"));
    temporaryRoots.push(root);
    const store = new ProjectStore(root);
    let variablesCalled = false;
    const fetchImpl = vi.fn<FigmaFetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.figma.com") {
        if (url.pathname === `/v1/files/${FILE_KEY}`) {
          return jsonResponse(createFigmaFileResponseFixture());
        }
        if (url.pathname === `/v1/files/${FILE_KEY}/images`) {
          return jsonResponse({
            meta: {
              images: {
                "image-source-1":
                  "https://s3-alpha.figma.com/assets/hero.png?signature=private",
              },
            },
          });
        }
        if (url.pathname === `/v1/images/${FILE_KEY}`) {
          const ids = url.searchParams.get("ids")?.split(",") ?? [];
          return jsonResponse({
            images: Object.fromEntries(
              ids.map((id) => [
                id,
                `https://s3-alpha.figma.com/screenshots/${id.replaceAll(
                  ":",
                  "-",
                )}.png?signature=private`,
              ]),
            ),
          });
        }
        if (
          url.pathname ===
          `/v1/files/${FILE_KEY}/variables/local`
        ) {
          variablesCalled = true;
          return new Response("should not be called", { status: 500 });
        }
      }
      if (url.pathname === "/assets/hero.png") {
        return imageResponse(createPngBytes(640, 480));
      }
      if (url.pathname.startsWith("/screenshots/")) {
        return imageResponse(createPngBytes(144, 144));
      }
      return new Response("unexpected", { status: 404 });
    });
    const inspector = new FigmaInspector({
      restClient: new FigmaRestClient({
        token: "private-token",
        fetchImpl,
        maxRetries: 0,
      }),
      imageDownloader: new FigmaImageDownloader({
        projectStore: store,
        fetchImpl,
      }),
      projectStore: store,
      now: () => new Date("2026-07-24T12:00:00.000Z"),
    });

    const output = await inspector.inspect(
      {
        schemaVersion: "1",
        projectId: "restricted-variables-project",
        figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Fixture`,
      },
      undefined,
      { variablesMode: "disabled_restricted_live" },
    );

    expect(variablesCalled).toBe(false);
    expect(output.variables).toMatchObject({
      status: "unavailable_optional",
      reasonCode: "restricted_mode",
    });
    expect(output.warnings).toContainEqual({
      code: "variables_unavailable_optional",
      detail: "Variables 可选能力不可用：restricted_mode",
    });
  });
});
