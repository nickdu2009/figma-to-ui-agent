import { describe, expect, it, vi } from "vitest";

import {
  FigmaRestClient,
  FigmaRestError,
  type FigmaFetch,
} from "../../../src/figma/rest-client.ts";

const FILE_KEY = "L8H9R9GfDn30yx5bPOmuaH";

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function expectRestCode(code: FigmaRestError["code"]) {
  return expect.objectContaining({
    name: "FigmaRestError",
    code,
  });
}

describe("FigmaRestClient", () => {
  it("构造固定主机 GET 请求并规范化节点 ID", async () => {
    const fetchImpl = vi.fn<FigmaFetch>(async () =>
      jsonResponse({ nodes: {} }),
    );
    const client = new FigmaRestClient({
      token: "private-token",
      fetchImpl,
    });

    await expect(
      client.getNodes(FILE_KEY, ["0-1", "0:1", "12:34"]),
    ).resolves.toEqual({ nodes: {} });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.origin).toBe("https://api.figma.com");
    expect(url.pathname).toBe(`/v1/files/${FILE_KEY}/nodes`);
    expect(url.searchParams.get("ids")).toBe("0:1,12:34");
    expect(init).toMatchObject({
      method: "GET",
      redirect: "manual",
    });
    expect(init?.headers).toMatchObject({
      Accept: "application/json",
      "X-Figma-Token": "private-token",
    });
  });

  it("覆盖文件、截图、图片填充和 Variables 端点", async () => {
    const urls: string[] = [];
    const fetchImpl: FigmaFetch = async (input) => {
      urls.push(String(input));
      return jsonResponse({ ok: true });
    };
    const client = new FigmaRestClient({
      token: "private-token",
      fetchImpl,
    });

    await client.getFile(FILE_KEY);
    await client.getImageRenders(FILE_KEY, ["0:1"], {
      format: "jpg",
      scale: 2,
    });
    await client.getImageFills(FILE_KEY);
    await client.getLocalVariables(FILE_KEY);

    expect(urls.map((value) => new URL(value).pathname)).toEqual([
      `/v1/files/${FILE_KEY}`,
      `/v1/images/${FILE_KEY}`,
      `/v1/files/${FILE_KEY}/images`,
      `/v1/files/${FILE_KEY}/variables/local`,
    ]);
  });

  it("按 Retry-After 和有限退避重试 429/5xx", async () => {
    let currentTime = 1_000;
    const responses = [
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "1" },
      }),
      new Response("temporary", { status: 503 }),
      jsonResponse({ ok: true }),
    ];
    const fetchImpl = vi.fn<FigmaFetch>(
      async () => responses.shift()!,
    );
    const sleeps: number[] = [];
    const logs: unknown[] = [];
    const client = new FigmaRestClient({
      token: "private-token",
      fetchImpl,
      maxRetries: 2,
      now: () => currentTime,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        currentTime += milliseconds;
      },
      rateLimitLogger: (event) => {
        logs.push(event);
      },
    });

    await expect(client.getFile(FILE_KEY)).resolves.toEqual({
      ok: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1_000, 500]);
    expect(logs).toEqual([
      expect.objectContaining({
        endpoint: "file",
        status: 429,
        retryAfterSeconds: "1",
        retryDelayMs: 1_000,
        autoRetry: true,
      }),
    ]);
  });

  it("默认对连续 429 保留更长等待窗口", async () => {
    let currentTime = 1_000;
    const responses = [
      ...Array.from(
        { length: 5 },
        () =>
          new Response("rate limited", {
            status: 429,
            headers: { "retry-after": "60" },
          }),
      ),
      jsonResponse({ ok: true }),
    ];
    const fetchImpl = vi.fn<FigmaFetch>(
      async () => responses.shift()!,
    );
    const sleeps: number[] = [];
    const client = new FigmaRestClient({
      token: "private-token",
      fetchImpl,
      now: () => currentTime,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        currentTime += milliseconds;
      },
      rateLimitLogger: () => undefined,
    });

    await expect(client.getFile(FILE_KEY)).resolves.toEqual({
      ok: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(sleeps).toEqual([
      60_000,
      60_000,
      60_000,
      60_000,
      60_000,
    ]);
  });

  it("按端点最小间隔在客户端内部排队", async () => {
    let currentTime = 1_000;
    const fetchImpl = vi.fn<FigmaFetch>(async () =>
      jsonResponse({ ok: true }),
    );
    const sleeps: number[] = [];
    const client = new FigmaRestClient({
      token: "private-token",
      fetchImpl,
      minIntervalMsByEndpoint: { file: 1_000 },
      now: () => currentTime,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        currentTime += milliseconds;
      },
    });

    await client.getFile(FILE_KEY);
    await client.getFile(FILE_KEY);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1_000]);
  });

  it("超长 Retry-After 不自动等待，并让后续请求命中本地限流", async () => {
    let currentTime = 10_000;
    const fetchImpl = vi.fn<FigmaFetch>(
      async () =>
        new Response("private rate limit payload", {
          status: 429,
          headers: {
            "retry-after": "397000",
            "x-figma-plan-tier": "starter",
            "x-figma-rate-limit-type": "low",
          },
        }),
    );
    const sleeps: number[] = [];
    const logs: unknown[] = [];
    const client = new FigmaRestClient({
      token: "private-token",
      fetchImpl,
      maxRetries: 5,
      maxAutoRetryAfterMs: 1_000,
      now: () => currentTime,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        currentTime += milliseconds;
      },
      rateLimitLogger: (event) => {
        logs.push(event);
      },
    });

    await expect(client.getFile(FILE_KEY)).rejects.toThrow(
      "超过本地自动等待上限",
    );
    await expect(client.getNodes(FILE_KEY, ["0:1"])).rejects.toThrow(
      "本地限流中",
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
    expect(logs).toEqual([
      expect.objectContaining({
        endpoint: "file",
        status: 429,
        attempt: 1,
        retryAfterSeconds: "397000",
        planTier: "starter",
        rateLimitType: "low",
        upgradeLinkPresent: false,
        retryDelayMs: 397_000_000,
        autoRetry: false,
      }),
    ]);
    expect(JSON.stringify(logs)).not.toContain("private-token");
    expect(JSON.stringify(logs)).not.toContain(FILE_KEY);
    expect(JSON.stringify(logs)).not.toContain(
      "private rate limit payload",
    );
  });

  it("重试耗尽后只返回清洗状态，不泄漏正文或 Token", async () => {
    const fetchImpl: FigmaFetch = async () =>
      new Response("private upstream payload", { status: 503 });
    const client = new FigmaRestClient({
      token: "private-token",
      fetchImpl,
      maxRetries: 1,
      sleep: async () => undefined,
    });

    let error: unknown;
    try {
      await client.getFile(FILE_KEY);
    } catch (caught) {
      error = caught;
    }
    expect(error).toEqual(expectRestCode("http_error"));
    expect(error).toMatchObject({
      status: 503,
      retryable: true,
    });
    expect(String(error)).not.toContain("private upstream payload");
    expect(String(error)).not.toContain("private-token");
    expect(String(error)).not.toContain(FILE_KEY);
  });

  it("429 失败时只暴露脱敏限流诊断头", async () => {
    const upgradeLink =
      "https://www.figma.com/pricing?token=private-upgrade-secret";
    const fetchImpl: FigmaFetch = async () =>
      new Response("private rate limit payload", {
        status: 429,
        headers: {
          "retry-after": "397000",
          "x-figma-plan-tier": "starter",
          "x-figma-rate-limit-type": "low",
          "x-figma-upgrade-link": upgradeLink,
        },
      });
    const client = new FigmaRestClient({
      token: "private-token",
      fetchImpl,
      maxRetries: 0,
      rateLimitLogger: () => undefined,
    });

    let error: unknown;
    try {
      await client.getFile(FILE_KEY);
    } catch (caught) {
      error = caught;
    }

    expect(error).toEqual(expectRestCode("http_error"));
    const message = String(error);
    expect(message).toContain("HTTP 429");
    expect(message).toContain("retryAfterSeconds=397000");
    expect(message).toContain("planTier=starter");
    expect(message).toContain("rateLimitType=low");
    expect(message).toContain("upgradeLinkPresent=true");
    expect(message).not.toContain("private rate limit payload");
    expect(message).not.toContain("private-token");
    expect(message).not.toContain(FILE_KEY);
    expect(message).not.toContain(upgradeLink);
  });

  it("拒绝重定向、错误 MIME、无效 JSON 和非对象 JSON", async () => {
    const cases: Array<[Response, FigmaRestError["code"]]> = [
      [
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/" },
        }),
        "redirect_forbidden",
      ],
      [
        new Response("{}", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
        "invalid_content_type",
      ],
      [
        new Response("{", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
        "invalid_json",
      ],
      [jsonResponse([]), "invalid_response_shape"],
    ];

    for (const [response, code] of cases) {
      const client = new FigmaRestClient({
        token: "private-token",
        fetchImpl: async () => response,
      });
      await expect(client.getFile(FILE_KEY)).rejects.toEqual(
        expectRestCode(code),
      );
    }
  });

  it("同时按 Content-Length 和实际读取字节限制响应", async () => {
    const declared = new FigmaRestClient({
      token: "private-token",
      maxResponseBytes: 10,
      fetchImpl: async () =>
        new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": "100",
          },
        }),
    });
    await expect(declared.getFile(FILE_KEY)).rejects.toEqual(
      expectRestCode("response_too_large"),
    );

    const streamed = new FigmaRestClient({
      token: "private-token",
      maxResponseBytes: 10,
      fetchImpl: async () => jsonResponse({ value: "too large" }),
    });
    await expect(streamed.getFile(FILE_KEY)).rejects.toEqual(
      expectRestCode("response_too_large"),
    );
  });

  it("区分超时和调用方取消", async () => {
    const waitingFetch: FigmaFetch = async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const rejectAbort = () =>
          reject(new DOMException("aborted", "AbortError"));
        if (signal?.aborted) {
          rejectAbort();
          return;
        }
        signal?.addEventListener("abort", rejectAbort, { once: true });
      });

    const timeoutClient = new FigmaRestClient({
      token: "private-token",
      fetchImpl: waitingFetch,
      timeoutMs: 10,
    });
    await expect(timeoutClient.getFile(FILE_KEY)).rejects.toEqual(
      expectRestCode("timeout"),
    );

    const controller = new AbortController();
    const abortedClient = new FigmaRestClient({
      token: "private-token",
      fetchImpl: waitingFetch,
    });
    const request = abortedClient.getFile(FILE_KEY, controller.signal);
    controller.abort();
    await expect(request).rejects.toEqual(expectRestCode("aborted"));
  });

  it("请求 URL 超限和非法配置在 fetch 前失败", async () => {
    const fetchImpl = vi.fn<FigmaFetch>();
    const client = new FigmaRestClient({
      token: "private-token",
      fetchImpl,
    });
    const manyLongIds = Array.from(
      { length: 100 },
      (_, index) =>
        `${index}:${"9".repeat(80)};${index + 1}:${"8".repeat(80)}`,
    );
    await expect(
      client.getNodes(FILE_KEY, manyLongIds),
    ).rejects.toEqual(expectRestCode("request_url_too_long"));
    expect(fetchImpl).not.toHaveBeenCalled();

    expect(
      () =>
        new FigmaRestClient({
          token: "private-token\ninjected",
          fetchImpl,
        }),
    ).toThrow("Figma Token 配置无效");
  });
});
