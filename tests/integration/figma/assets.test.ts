import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FigmaAssetError,
  FigmaImageDownloader,
  parseFigmaImageUrl,
} from "../../../src/figma/assets.ts";
import type { FigmaFetch } from "../../../src/figma/rest-client.ts";
import {
  ProjectStore,
} from "../../../src/project-store/store.ts";
import {
  createJpegBytes,
  createPngBytes,
} from "../../fixtures/images.ts";

const temporaryRoots: string[] = [];

async function createStore(): Promise<{
  root: string;
  store: ProjectStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "figma-assets-"));
  temporaryRoots.push(root);
  return { root, store: new ProjectStore(root) };
}

function imageResponse(
  bytes: Uint8Array,
  contentType = "image/png",
  init: ResponseInit = {},
): Response {
  return new Response(Uint8Array.from(bytes).buffer, {
    status: 200,
    ...init,
    headers: {
      "content-type": contentType,
      ...init.headers,
    },
  });
}

function expectAssetCode(code: FigmaAssetError["code"]) {
  return expect.objectContaining({
    name: "FigmaAssetError",
    code,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("Figma 图片 URL", () => {
  it("允许已知 Figma/CDN HTTPS 主机", () => {
    expect(
      parseFigmaImageUrl(
        "https://s3-alpha.figma.com/img/example?signature=private",
      ).hostname,
    ).toBe("s3-alpha.figma.com");
    expect(
      parseFigmaImageUrl(
        "https://bucket.s3.us-west-2.amazonaws.com/image.png",
      ).hostname,
    ).toBe("bucket.s3.us-west-2.amazonaws.com");
  });

  it.each([
    "http://s3-alpha.figma.com/image.png",
    "https://127.0.0.1/image.png",
    "https://localhost/image.png",
    "https://evil.example/image.png",
    "https://user:secret@s3-alpha.figma.com/image.png",
    "https://s3-alpha.figma.com:444/image.png",
    "https://s3-alpha.figma.com/image.png#fragment",
  ])("拒绝不安全图片 URL：%s", (url) => {
    expect(() => parseFigmaImageUrl(url)).toThrow(FigmaAssetError);
  });
});

describe("FigmaImageDownloader", () => {
  it("下载一次并按内容哈希去重保存多个来源引用", async () => {
    const { root, store } = await createStore();
    const bytes = createPngBytes(10, 20);
    const fetchImpl = vi.fn<FigmaFetch>(async () =>
      imageResponse(bytes),
    );
    const downloader = new FigmaImageDownloader({
      projectStore: store,
      fetchImpl,
    });
    const url = "https://s3-alpha.figma.com/img/shared";

    const refs = await downloader.downloadAll("demo-project", [
      { sourceRef: "image-a", url, kind: "assets" },
      { sourceRef: "image-b", url, kind: "assets" },
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(refs.get("image-a")).toEqual(refs.get("image-b"));
    expect(refs.get("image-a")).toMatchObject({
      mimeType: "image/png",
      width: 10,
      height: 20,
      byteCount: bytes.byteLength,
    });
    const localRef = refs.get("image-a")!;
    await expect(
      readFile(
        join(root, "projects", "demo-project", localRef.path),
      ),
    ).resolves.toEqual(Buffer.from(bytes));
    const entries = await readdir(
      join(root, "projects", "demo-project", "figma", "assets"),
    );
    expect(entries).toEqual([`${localRef.sha256}.png`]);
  });

  it("同一远端图片可一次下载并分别保存资产和截图", async () => {
    const { store } = await createStore();
    const fetchImpl = vi.fn<FigmaFetch>(async () =>
      imageResponse(createJpegBytes(), "image/jpeg"),
    );
    const downloader = new FigmaImageDownloader({
      projectStore: store,
      fetchImpl,
    });
    const url = "https://s3-alpha.figma.com/img/shared-jpeg";

    const refs = await downloader.downloadAll("demo-project", [
      { sourceRef: "asset", url, kind: "assets" },
      { sourceRef: "screenshot", url, kind: "screenshots" },
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(refs.get("asset")?.path).toMatch(/^figma\/assets\//);
    expect(refs.get("screenshot")?.path).toMatch(
      /^figma\/screenshots\//,
    );
    expect(refs.get("asset")?.sha256).toBe(
      refs.get("screenshot")?.sha256,
    );
  });

  it("并发下载不超过 4", async () => {
    const { store } = await createStore();
    let active = 0;
    let maximumActive = 0;
    const fetchImpl: FigmaFetch = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return imageResponse(createPngBytes());
    };
    const downloader = new FigmaImageDownloader({
      projectStore: store,
      fetchImpl,
      maxConcurrency: 4,
    });

    await downloader.downloadAll(
      "demo-project",
      Array.from({ length: 8 }, (_, index) => ({
        sourceRef: `image-${index}`,
        url: `https://s3-alpha.figma.com/img/${index}`,
        kind: "assets" as const,
      })),
    );

    expect(maximumActive).toBe(4);
  });

  it("拒绝重定向、MIME 伪装、超限和冲突来源", async () => {
    const { store } = await createStore();
    const url = "https://s3-alpha.figma.com/img/invalid";

    const cases: Array<[Response, FigmaAssetError["code"]]> = [
      [
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/image.png" },
        }),
        "redirect_forbidden",
      ],
      [imageResponse(createPngBytes(), "text/plain"), "invalid_content_type"],
      [
        imageResponse(createPngBytes(), "image/jpeg"),
        "format_mismatch",
      ],
      [
        imageResponse(createPngBytes(), "image/png", {
          headers: { "content-length": "1000" },
        }),
        "image_too_large",
      ],
    ];
    for (const [response, code] of cases) {
      const downloader = new FigmaImageDownloader({
        projectStore: store,
        maxImageBytes: code === "image_too_large" ? 100 : 1024,
        fetchImpl: async () => response,
      });
      await expect(
        downloader.downloadAll("demo-project", [
          { sourceRef: code, url, kind: "assets" },
        ]),
      ).rejects.toEqual(expectAssetCode(code));
    }

    const downloader = new FigmaImageDownloader({
      projectStore: store,
      fetchImpl: async () => imageResponse(createPngBytes()),
    });
    await expect(
      downloader.downloadAll("demo-project", [
        { sourceRef: "same", url, kind: "assets" },
        {
          sourceRef: "same",
          url: "https://s3-alpha.figma.com/img/other",
          kind: "assets",
        },
      ]),
    ).rejects.toEqual(expectAssetCode("invalid_source_ref"));
  });

  it("区分超时和调用方取消，错误不包含签名 URL", async () => {
    const { store } = await createStore();
    const url =
      "https://s3-alpha.figma.com/img/wait?signature=private-value";
    const waitingFetch: FigmaFetch = async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        const rejectAbort = () =>
          reject(new DOMException("aborted", "AbortError"));
        if (init?.signal?.aborted) {
          rejectAbort();
          return;
        }
        init?.signal?.addEventListener("abort", rejectAbort, {
          once: true,
        });
      });

    const timeoutDownloader = new FigmaImageDownloader({
      projectStore: store,
      fetchImpl: waitingFetch,
      timeoutMs: 10,
    });
    let timeoutError: unknown;
    try {
      await timeoutDownloader.downloadAll("demo-project", [
        { sourceRef: "timeout", url, kind: "assets" },
      ]);
    } catch (error) {
      timeoutError = error;
    }
    expect(timeoutError).toEqual(expectAssetCode("timeout"));
    expect(String(timeoutError)).not.toContain("private-value");

    const controller = new AbortController();
    const abortDownloader = new FigmaImageDownloader({
      projectStore: store,
      fetchImpl: waitingFetch,
    });
    const request = abortDownloader.downloadAll(
      "demo-project",
      [{ sourceRef: "abort", url, kind: "assets" }],
      controller.signal,
    );
    controller.abort();
    await expect(request).rejects.toEqual(expectAssetCode("aborted"));
  });

  it("并发下载失败时保留首个真实错误而不是内部取消", async () => {
    const { store } = await createStore();
    let releaseSlowFetch: (() => void) | undefined;
    const fetchImpl: FigmaFetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/slow")) {
        await new Promise<void>((resolve, reject) => {
          releaseSlowFetch = resolve;
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
        return imageResponse(createPngBytes());
      }
      releaseSlowFetch?.();
      return imageResponse(createPngBytes(), "text/plain");
    };
    const downloader = new FigmaImageDownloader({
      projectStore: store,
      fetchImpl,
      maxConcurrency: 2,
    });

    await expect(
      downloader.downloadAll("demo-project", [
        {
          sourceRef: "slow",
          url: "https://s3-alpha.figma.com/img/slow",
          kind: "assets",
        },
        {
          sourceRef: "bad",
          url: "https://s3-alpha.figma.com/img/bad",
          kind: "assets",
        },
      ]),
    ).rejects.toEqual(expectAssetCode("invalid_content_type"));
  });

  it("ProjectStore 检测已存在内容寻址文件损坏且不留临时文件", async () => {
    const { root, store } = await createStore();
    const bytes = createPngBytes();
    const ref = await store.saveLocalImage({
      projectId: "demo-project",
      kind: "assets",
      bytes,
    });
    const destination = join(
      root,
      "projects",
      "demo-project",
      ref.path,
    );
    await writeFile(destination, "corrupted", "utf8");

    await expect(
      store.saveLocalImage({
        projectId: "demo-project",
        kind: "assets",
        bytes,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "invalid_stored_data",
      }),
    );
    const entries = await readdir(
      join(root, "projects", "demo-project", "figma", "assets"),
    );
    expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
  });
});
