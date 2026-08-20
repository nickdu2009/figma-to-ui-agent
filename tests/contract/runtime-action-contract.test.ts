/**
 * S8 契约测试（计划 S8 验证；无数据库）：
 * - 服务端信封 strict schema（未知键/动作枚举/幂等键长度）；
 * - CSV：公式中和矩阵（直接前缀/Unicode 空白与控制前缀/已有 apostrophe）、
 *   RFC 4180（逗号/双引号/多行）、10,000 行与 10 MiB 上限（正文前 413）、
 *   文件名安全化；
 * - requestHash 规范确定性；
 * - Adapter 阶段路由：published→dispatch 路由+版本头；draft 读→data-view；
 *   draft 写/导出与 unsaved/staging → fail closed 且零网络调用；
 * - DownloadIntent Host：begin/一次性消费/重复消费/撤销/取消（注入假 target）。
 */
import { describe, expect, it } from "vitest";
import {
  CSV_MAX_BYTES,
  CSV_MAX_RECORDS,
  encodeCsv,
  encodeCsvCell,
  needsFormulaNeutralization,
  neutralizeFormula,
  safeExportFileName,
} from "../../server/actions/csv-export.ts";
import {
  BusinessActionError,
  businessActionCommandSchema,
  computeRequestHash,
} from "../../server/actions/contracts.ts";
import { createBrowserRuntimeActionAdapter } from "../../src/runtime/runtime-action-adapter.ts";
import {
  createDownloadIntentHost,
  type DownloadIntent,
} from "../../src/runtime/download-intent.ts";

// ---------- CSV 公式中和矩阵 ----------

describe("S8 CSV：公式中和", () => {
  it("直接触发前缀 = + - @ 全部中和（前置 apostrophe）", () => {
    for (const trigger of ["=1+1", "+SUM(A1)", "-2+3", "@mention"]) {
      expect(needsFormulaNeutralization(trigger)).toBe(true);
      expect(neutralizeFormula(trigger)).toBe(`'${trigger}`);
    }
  });

  it("HT/CR/LF 开头即中和（Excel 剥皮执行面）", () => {
    for (const raw of ["\t=cmd", "\r1", "\n2"]) {
      expect(needsFormulaNeutralization(raw)).toBe(true);
      expect(neutralizeFormula(raw)).toBe(`'${raw}`);
    }
  });

  it("Unicode 空白/控制字符前缀后的触发字符也中和", () => {
    // NBSP、零宽空格、BEL 控制字符前缀
    for (const raw of [" =1", "​=1", "+x"]) {
      expect(needsFormulaNeutralization(raw)).toBe(true);
      expect(neutralizeFormula(raw)).toBe(`'${raw}`);
    }
  });

  it("已有 apostrophe 前缀不重复中和", () => {
    expect(needsFormulaNeutralization("'=1+1")).toBe(false);
    expect(neutralizeFormula("'=1+1")).toBe("'=1+1");
  });

  it("普通文本/数字/中文/前导字母不中和", () => {
    for (const raw of ["hello", "abc=1", "中文", "x-1", " ", ""]) {
      expect(needsFormulaNeutralization(raw)).toBe(false);
      expect(neutralizeFormula(raw)).toBe(raw);
    }
  });
});

describe("S8 CSV：RFC 4180 与限额", () => {
  it("逗号/双引号/多行字段正确包围与转义", () => {
    expect(encodeCsvCell("a,b")).toBe('"a,b"');
    expect(encodeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(encodeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(encodeCsvCell("plain")).toBe("plain");
    expect(encodeCsvCell(null)).toBe("");
    expect(encodeCsvCell(42)).toBe("42");
    expect(encodeCsvCell(true)).toBe("true");
  });

  it("完整正文：CRLF 行分隔 + 中和后编码", () => {
    const result = encodeCsv({
      headers: ["name", "note"],
      rows: [
        ["=1+1", "plain"],
        ['a"b', "x,y"],
      ],
      totalRows: 2,
    });
    expect(result.body).toBe(
      'name,note\r\n\'=1+1,plain\r\n"a""b","x,y"\r\n',
    );
    expect(result.rowCount).toBe(2);
    expect(result.byteLength).toBe(Buffer.byteLength(result.body, "utf8"));
  });

  it("limit+1（totalRows > 10,000）在正文编码前抛 export_too_large", () => {
    expect(() =>
      encodeCsv({ headers: ["a"], rows: [["x"]], totalRows: CSV_MAX_RECORDS + 1 }),
    ).toThrowError(BusinessActionError);
    try {
      encodeCsv({ headers: ["a"], rows: [], totalRows: CSV_MAX_RECORDS + 1 });
      expect.unreachable();
    } catch (error) {
      expect((error as BusinessActionError).code).toBe("export_too_large");
      expect((error as BusinessActionError).status).toBe(413);
    }
  });

  it("10 MiB 完整 UTF-8 正文上限（正文前 413）", () => {
    // 构造单行超大文本（多字节字符确保按 UTF-8 字节计）
    const bigCell = "界".repeat(Math.ceil(CSV_MAX_BYTES / 3));
    try {
      encodeCsv({ headers: ["a"], rows: [[bigCell]], totalRows: 1 });
      expect.unreachable();
    } catch (error) {
      expect((error as BusinessActionError).code).toBe("export_too_large");
    }
  });

  it("文件名安全化：路径/控制字符剔除、长度封顶、空回退", () => {
    const name = safeExportFileName("../etc/passwd\n", new Date("2026-01-02T03:04:05Z"));
    expect(name).not.toMatch(/[/\\\r\n]/);
    expect(name.endsWith(".csv")).toBe(true);
    expect(safeExportFileName("", new Date())).toMatch(/^export.*\.csv$/);
    // base 封顶 48 字符（+ "-" 1 + ISO 时间戳 24 + ".csv" 4 = 77）
    expect(
      safeExportFileName("a".repeat(100), new Date()).length,
    ).toBeLessThanOrEqual(48 + 1 + 24 + 4);
  });
});

// ---------- 服务端信封 ----------

describe("S8 服务端信封 strict schema", () => {
  const base = {
    protocolVersion: 1,
    publishedVersionId: "pv-1",
    actionName: "createRecord",
    idempotencyKey: "idem-00000001",
    canonicalParams: { collectionKey: "tasks", data: { title: "x" } },
  };

  it("合法信封通过；未知键被拒（strict）", () => {
    expect(businessActionCommandSchema.safeParse(base).success).toBe(true);
    expect(
      businessActionCommandSchema.safeParse({ ...base, role: "owner" }).success,
    ).toBe(false);
    expect(
      businessActionCommandSchema.safeParse({ ...base, appId: "other" }).success,
    ).toBe(false);
    expect(
      businessActionCommandSchema.safeParse({ ...base, identity: {} }).success,
    ).toBe(false);
  });

  it("actionName 枚举闭合；未知动作拒绝", () => {
    expect(
      businessActionCommandSchema.safeParse({ ...base, actionName: "dropTable" })
        .success,
    ).toBe(false);
  });

  it("idempotencyKey 长度边界（<8 或 >128 拒绝）", () => {
    expect(
      businessActionCommandSchema.safeParse({ ...base, idempotencyKey: "short" })
        .success,
    ).toBe(false);
    expect(
      businessActionCommandSchema.safeParse({
        ...base,
        idempotencyKey: "k".repeat(129),
      }).success,
    ).toBe(false);
  });

  it("requestHash 规范确定：键序无关、内容敏感", () => {
    const input = {
      protocolVersion: 1 as const,
      appId: "app-1",
      membershipId: "m-1",
      publishedVersionId: "pv-1",
      canonicalActionName: "createRecord",
      collectionKey: "tasks",
      canonicalParams: { b: 1, a: { y: 2, x: 1 } },
    };
    const reordered = {
      ...input,
      canonicalParams: { a: { x: 1, y: 2 }, b: 1 },
    };
    expect(computeRequestHash(input)).toBe(computeRequestHash(reordered));
    expect(
      computeRequestHash({ ...input, canonicalParams: { b: 2, a: { y: 2, x: 1 } } }),
    ).not.toBe(computeRequestHash(input));
  });
});

// ---------- Adapter 阶段路由 ----------

type FetchCall = { url: string; init?: RequestInit };

function makeFetchSpy(responseFactory: (call: FetchCall) => Response) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return responseFactory(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const surface = {
  navigate: () => {},
  showToast: () => {},
  setDialogOpen: () => {},
};

function makeInput(overrides: Partial<{
  phase: "unsaved" | "staging" | "draft" | "published";
  publishedVersionId: string;
  draftId: string;
  idempotencyKey: string | null;
  params: Record<string, unknown>;
}>) {
  return {
    dispatchId: "d-1",
    idempotencyKey: overrides.idempotencyKey ?? null,
    params: overrides.params ?? { collectionKey: "tasks" },
    phase: overrides.phase ?? "published",
    identity: {
      appId: "app-1",
      candidateDigest: "cd",
      bundleRevision: 1,
      ...(overrides.publishedVersionId
        ? { publishedVersionId: overrides.publishedVersionId }
        : {}),
      ...(overrides.draftId ? { draftId: overrides.draftId } : {}),
    },
    signal: new AbortController().signal,
  } as const;
}

describe("S8 Adapter 阶段路由", () => {
  it("published 数据读：POST dispatch 路由 + X-VMA-Published-Version 头 + 严格信封", async () => {
    const { calls, fetchImpl } = makeFetchSpy(() =>
      jsonResponse(200, {
        serverRequestId: "srv-1",
        status: "success",
        data: { items: [], nextCursor: null },
      }),
    );
    const adapter = createBrowserRuntimeActionAdapter({
      appId: "app-1",
      surface,
      fetchImpl,
    });
    const result = await adapter.handlers.queryRecords!(
      makeInput({ publishedVersionId: "pv-1" }),
    );
    expect(result.status).toBe("success");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/apps/app-1/runtime-actions/dispatch");
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers["x-vma-published-version"]).toBe("pv-1");
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body).toEqual({
      protocolVersion: 1,
      publishedVersionId: "pv-1",
      actionName: "queryRecords",
      canonicalParams: { collectionKey: "tasks" },
    });
  });

  it("published 写命令携带 idempotencyKey；服务端错误码原样透传", async () => {
    const { calls, fetchImpl } = makeFetchSpy(() =>
      jsonResponse(409, {
        serverRequestId: "srv-2",
        status: "error",
        error: { code: "revision_conflict", message: "修订冲突" },
      }),
    );
    const adapter = createBrowserRuntimeActionAdapter({
      appId: "app-1",
      surface,
      fetchImpl,
    });
    const result = await adapter.handlers.updateRecord!(
      makeInput({
        publishedVersionId: "pv-1",
        idempotencyKey: "idem-00000002",
        params: {
          collectionKey: "tasks",
          recordId: "r-1",
          expectedRevision: 3,
          patch: { title: "y" },
        },
      }),
    );
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.error.code).toBe(
      "revision_conflict",
    );
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.idempotencyKey).toBe("idem-00000002");
  });

  it("draft 读走 data-view 路由；draft 写/导出 draft_readonly 且零网络", async () => {
    const { calls, fetchImpl } = makeFetchSpy(() =>
      jsonResponse(200, { items: [], nextCursor: null }),
    );
    const adapter = createBrowserRuntimeActionAdapter({
      appId: "app-1",
      surface,
      fetchImpl,
    });
    const read = await adapter.handlers.queryRecords!(
      makeInput({ phase: "draft", draftId: "draft-1" }),
    );
    expect(read.status).toBe("success");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "/api/apps/app-1/drafts/draft-1/data-view/tasks/query",
    );

    const write = await adapter.handlers.createRecord!(
      makeInput({
        phase: "draft",
        draftId: "draft-1",
        idempotencyKey: "idem-00000003",
        params: { collectionKey: "tasks", data: { title: "x" } },
      }),
    );
    expect(write.status).toBe("error");
    expect(write.status === "error" && write.error.code).toBe("draft_readonly");
    expect(calls).toHaveLength(1); // 无新增网络调用
  });

  it("unsaved/staging 一切数据 Action fail closed 且零网络", async () => {
    const { calls, fetchImpl } = makeFetchSpy(() => jsonResponse(200, {}));
    const adapter = createBrowserRuntimeActionAdapter({
      appId: "app-1",
      surface,
      fetchImpl,
    });
    for (const phase of ["unsaved", "staging"] as const) {
      const result = await adapter.handlers.queryRecords!(
        makeInput({ phase }),
      );
      expect(result.status).toBe("error");
      expect(result.status === "error" && result.error.code).toBe(
        "action_forbidden",
      );
    }
    expect(calls).toHaveLength(0);
  });

  it("缺 publishedVersionId 的 published 请求 fail closed 且零网络", async () => {
    const { calls, fetchImpl } = makeFetchSpy(() => jsonResponse(200, {}));
    const adapter = createBrowserRuntimeActionAdapter({
      appId: "app-1",
      surface,
      fetchImpl,
    });
    const result = await adapter.handlers.queryRecords!(makeInput({}));
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.error.code).toBe(
      "action_forbidden",
    );
    expect(calls).toHaveLength(0);
  });
});

// ---------- DownloadIntent Host ----------

interface FakeTarget {
  document: {
    title: string;
    createElement: (tag: string) => FakeAnchor;
    body: { append: (node: FakeAnchor) => void };
  };
  close: () => void;
}

interface FakeAnchor {
  download: string;
  href: string;
  click: () => void;
}

function makeFakeTarget(log: string[]): FakeTarget {
  return {
    document: {
      title: "",
      createElement: () => {
        const anchor: FakeAnchor = {
          download: "",
          href: "",
          click: () => log.push("anchor-click"),
        };
        return anchor;
      },
      body: { append: () => log.push("append") },
    },
    close: () => log.push("close"),
  };
}

describe("S8 DownloadIntent Host", () => {
  it("begin→complete 恰好消费一次；重复消费稳定拒绝", () => {
    const log: string[] = [];
    const timers: Array<() => void> = [];
    const host = createDownloadIntentHost({
      openTarget: () => makeFakeTarget(log) as unknown as Window,
      setTimeoutImpl: ((fn: () => void) => {
        timers.push(fn);
        return 0;
      }) as unknown as typeof setTimeout,
    });
    const intent = host.beginDownloadIntent();
    expect(intent).not.toBeNull();
    const first = host.completeDownload(
      intent as DownloadIntent,
      "records.csv",
      new Uint8Array([97, 98]),
      "text/csv",
    );
    expect(first.ok).toBe(true);
    const second = host.completeDownload(
      intent as DownloadIntent,
      "records.csv",
      new Uint8Array([97, 98]),
      "text/csv",
    );
    expect(second).toEqual({
      ok: false,
      code: "download_intent_already_consumed",
    });
    expect(log.filter((entry) => entry === "anchor-click")).toHaveLength(1);
    // 清理定时器：关闭 target 并移除句柄
    for (const fn of timers.splice(0)) fn();
    const third = host.completeDownload(
      intent as DownloadIntent,
      "x.csv",
      new Uint8Array([97]),
      "text/csv",
    );
    expect(third).toEqual({ ok: false, code: "download_intent_unknown" });
  });

  it("popup 阻止 → begin 返回 null（无下载、无副作用）", () => {
    const host = createDownloadIntentHost({ openTarget: () => null });
    expect(host.beginDownloadIntent()).toBeNull();
  });

  it("revokeAll 后迟到完成 → download_intent_revoked，无下载", () => {
    const log: string[] = [];
    const host = createDownloadIntentHost({
      openTarget: () => makeFakeTarget(log) as unknown as Window,
    });
    const intent = host.beginDownloadIntent();
    expect(intent).not.toBeNull();
    host.revokeAll();
    const late = host.completeDownload(
      intent as DownloadIntent,
      "late.csv",
      new Uint8Array([97]),
      "text/csv",
    );
    // revokeAll 清空句柄表 → 迟到完成按 unknown/revoked 稳定失败，均无下载
    expect(late.ok).toBe(false);
    expect(log.filter((entry) => entry === "anchor-click")).toHaveLength(0);
  });

  it("cancelDownload：关闭 target、移除句柄；重复取消幂等", () => {
    const log: string[] = [];
    const host = createDownloadIntentHost({
      openTarget: () => makeFakeTarget(log) as unknown as Window,
    });
    const intent = host.beginDownloadIntent();
    expect(intent).not.toBeNull();
    host.cancelDownload(intent as DownloadIntent);
    host.cancelDownload(intent as DownloadIntent);
    expect(log.filter((entry) => entry === "close")).toHaveLength(1);
    const after = host.completeDownload(
      intent as DownloadIntent,
      "x.csv",
      new Uint8Array([97]),
      "text/csv",
    );
    expect(after).toEqual({ ok: false, code: "download_intent_unknown" });
  });

  it("downloadExport handler：同步前缀建 intent；字节消费一次；结果只含摘要", async () => {
    const log: string[] = [];
    const csvBytes = new TextEncoder().encode("name\r\n'=1+1\r\n");
    const host = createDownloadIntentHost({
      openTarget: () => makeFakeTarget(log) as unknown as Window,
      setTimeoutImpl: ((fn: () => void) => {
        queueMicrotask(fn);
        return 0;
      }) as unknown as typeof setTimeout,
    });
    const { calls, fetchImpl } = makeFetchSpy(
      () =>
        new Response(csvBytes, {
          status: 200,
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": 'attachment; filename="tasks_2026.csv"',
            "x-vma-export-row-count": "1",
            "x-vma-export-byte-length": String(csvBytes.byteLength),
          },
        }),
    );
    const adapter = createBrowserRuntimeActionAdapter({
      appId: "app-1",
      surface,
      fetchImpl,
      downloadIntents: host,
    });
    const result = await adapter.handlers.downloadExport!(
      makeInput({ publishedVersionId: "pv-1" }),
    );
    expect(result.status).toBe("success");
    expect(calls[0]!.url).toBe("/api/apps/app-1/runtime-actions/export");
    expect(log).toContain("anchor-click");
    if (result.status === "success") {
      expect(result.data).toEqual({
        fileName: "tasks_2026.csv",
        rowCount: 1,
        byteLength: csvBytes.byteLength,
      });
      // CSV 字节不进入 ActionResult
      expect(JSON.stringify(result.data)).not.toContain("=1+1");
    }
  });

  it("downloadExport handler：导出 413 → 取消 intent、无下载、稳定错误码", async () => {
    const log: string[] = [];
    const host = createDownloadIntentHost({
      openTarget: () => makeFakeTarget(log) as unknown as Window,
    });
    const { fetchImpl } = makeFetchSpy(() =>
      jsonResponse(413, {
        serverRequestId: "srv-3",
        status: "error",
        error: { code: "export_too_large", message: "导出记录数超限" },
      }),
    );
    const adapter = createBrowserRuntimeActionAdapter({
      appId: "app-1",
      surface,
      fetchImpl,
      downloadIntents: host,
    });
    const result = await adapter.handlers.downloadExport!(
      makeInput({ publishedVersionId: "pv-1" }),
    );
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.error.code).toBe(
      "export_too_large",
    );
    expect(log).not.toContain("anchor-click");
    expect(log).toContain("close");
  });
});
