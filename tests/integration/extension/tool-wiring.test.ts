import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createFigmaToUiExtension } from "../../../src/extension.ts";
import { buildInspectAgentContext } from "../../../src/runtime/inspect-agent-context.ts";
import type { ExtensionToolServices } from "../../../src/runtime/tool-services.ts";
import { EXACT_TOOL_NAMES } from "../../../src/runtime/tool-boundary.ts";
import {
  createDesignBundleDraft,
  createUISpecDraft,
} from "../../fixtures/contracts.ts";

function createFakePi() {
  const handlers = new Map<
    string,
    Array<(event: unknown, context: ExtensionContext) => unknown>
  >();
  const tools: Array<{
    name: string;
    execute: (...args: any[]) => Promise<any>;
  }> = [];
  let activeTools: string[] = [];
  const api = {
    on(eventName: string, handler: (event: unknown, context: ExtensionContext) => unknown) {
      const current = handlers.get(eventName) ?? [];
      current.push(handler);
      handlers.set(eventName, current);
    },
    registerTool(tool: {
      name: string;
      execute: (...args: any[]) => Promise<any>;
    }) {
      tools.push(tool);
    },
    setActiveTools(names: string[]) {
      activeTools = [...names];
    },
    getActiveTools() {
      return [...activeTools];
    },
    getAllTools() {
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.name,
        parameters: {},
        sourceInfo: {
          path: "./src/extension.ts",
          source: "extension",
          scope: "temporary",
          origin: "top-level",
        },
      }));
    },
  };
  return {
    api: api as unknown as ExtensionAPI,
    tools,
    async emit(eventName: string, event: unknown, context: ExtensionContext) {
      return await Promise.all(
        (handlers.get(eventName) ?? []).map((handler) =>
          handler(event, context),
        ),
      );
    },
  };
}

function tool(
  tools: ReturnType<typeof createFakePi>["tools"],
  name: string,
) {
  return tools.find((candidate) => candidate.name === name)!;
}

describe("Pi 四工具接线", () => {
  it("记录紧凑且脱敏的 M3 工具生命周期", async () => {
    const cwd = await mkdtemp(
      resolve(tmpdir(), "figma-to-ui-agent-audit-"),
    );
    const auditRelativePath =
      "data/calibration/m3/audit-case/tool-events.redacted.jsonl";
    const environmentKeys = [
      "M3_AGENT_AUDIT_RELATIVE_PATH",
      "M3_FLOW_FIGMA_URL",
      "FIGMA_API_KEY",
      "OPENAI_API_KEY",
    ] as const;
    const previousEnvironment = Object.fromEntries(
      environmentKeys.map((key) => [key, process.env[key]]),
    );
    process.env.M3_AGENT_AUDIT_RELATIVE_PATH =
      auditRelativePath;
    const rawFigmaUrl =
      "https://www.figma.com/design/AbCdEf1234567890/Audit";
    const rawFileKey = "AbCdEf1234567890";
    const rawFigmaToken = "figd_AuditToken1234567890";
    const rawOpenAiToken = "sk-AuditToken1234567890";
    process.env.M3_FLOW_FIGMA_URL = rawFigmaUrl;
    process.env.FIGMA_API_KEY = rawFigmaToken;
    process.env.OPENAI_API_KEY = rawOpenAiToken;

    try {
      const auditPath = resolve(cwd, auditRelativePath);
      await mkdir(
        resolve(cwd, "data/calibration/m3/audit-case"),
        { recursive: true },
      );
      await writeFile(auditPath, "", {
        encoding: "utf8",
        mode: 0o644,
      });
      const fake = createFakePi();
      createFigmaToUiExtension({
        services: {} as ExtensionToolServices,
      })(fake.api);
      const context = {
        cwd,
        hasUI: false,
        abort: vi.fn(),
      } as unknown as ExtensionContext;

      await fake.emit(
        "tool_execution_start",
        {
          type: "tool_execution_start",
          toolCallId: "call-1",
          toolName: "render_and_compare",
          args: {
            projectId: "audit-project",
            figmaUrl: rawFigmaUrl,
          },
        },
        context,
      );
      await fake.emit(
        "tool_execution_end",
        {
          type: "tool_execution_end",
          toolCallId: "call-1",
          toolName: "render_and_compare",
          isError: true,
          result: {
            content: [
              {
                type: "text",
                text: [
                  "bounded_loop_violation:",
                  rawFigmaUrl,
                  rawFileKey,
                  rawFigmaToken,
                  rawOpenAiToken,
                ].join(" "),
              },
            ],
          },
        },
        context,
      );
      await fake.emit(
        "message_end",
        {
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "stop",
            content: [
              {
                type: "toolCall",
                name: "render_and_compare",
              },
            ],
          },
        },
        context,
      );

      const content = await readFile(auditPath, "utf8");
      const records = content
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      expect(records).toEqual([
        expect.objectContaining({
          event: "tool_execution_start",
          toolName: "render_and_compare",
          projectId: "audit-project",
          argsSummary: expect.objectContaining({
            fields: expect.objectContaining({
              figmaUrl: expect.objectContaining({
                figmaUrlValid: true,
              }),
            }),
          }),
        }),
        expect.objectContaining({
          event: "tool_execution_end",
          toolName: "render_and_compare",
          projectId: "audit-project",
          isError: true,
          errorMessage:
            "bounded_loop_violation: <figma-url-redacted> <figma-file-key-redacted> <figma-token-redacted> <openai-token-redacted>",
        }),
        expect.objectContaining({
          event: "assistant_message_end",
          stopReason: "stop",
          contentTypes: ["toolCall"],
          toolNames: ["render_and_compare"],
          hasText: false,
        }),
      ]);
      expect(records[0]).not.toHaveProperty("args");
      expect(content).not.toContain(rawFigmaUrl);
      expect(content).not.toContain(rawFileKey);
      expect(content).not.toContain(rawFigmaToken);
      expect(content).not.toContain(rawOpenAiToken);
      expect((await stat(auditPath)).mode & 0o777).toBe(0o600);
    } finally {
      for (const key of environmentKeys) {
        const previousValue = previousEnvironment[key];
        if (previousValue === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previousValue;
        }
      }
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("执行受控工具链、限制三次迭代并清理资源", async () => {
    const uiSpecDraft = createUISpecDraft();
    const uiSpec = { ...uiSpecDraft, revision: 1 };
    const designBundle = {
      ...createDesignBundleDraft(),
      revision: 1,
    };
    const variables = designBundle.capabilities.variables;
    const renderMock = vi.fn(async (input, _signal?: AbortSignal) => ({
      schemaVersion: "1" as const,
      projectId: input.projectId,
      runId: "test-run",
      previewUrl: "http://127.0.0.1:4173/",
      passed: false,
      results: [],
    }));
    const services: ExtensionToolServices = {
      inspect: vi.fn(async (input) => ({
        schemaVersion: "1" as const,
        projectId: input.projectId,
        designBundleRevision: 1,
        pages: [],
        variables,
        warnings: [],
      })),
      inspectSupplement: vi.fn(async () => ({
        context: buildInspectAgentContext(designBundle),
        images: [
          {
            data: Buffer.from("image").toString("base64"),
            mimeType: "image/png" as const,
          },
        ],
      })),
      load: vi.fn(async (input) => ({
        schemaVersion: "1" as const,
        projectId: input.projectId,
        revision: 1,
        uiSpec,
      })),
      save: vi.fn(async (input) => ({
        schemaVersion: "1" as const,
        projectId: input.projectId,
        revision: input.baseRevision + 1,
        validation: {
          schemaValid: true as const,
          referencesValid: true as const,
          warningCount: 0,
        },
      })),
      render: renderMock,
      close: vi.fn(async () => undefined),
    };
    const fake = createFakePi();
    createFigmaToUiExtension({ services })(fake.api);
    const context = {
      cwd: "/tmp/figma-to-ui-agent",
      hasUI: false,
      abort: vi.fn(),
    } as unknown as ExtensionContext;

    await fake.emit("session_start", {}, context);
    await fake.emit("input", {}, context);
    await fake.emit("turn_start", {}, context);
    expect(fake.api.getActiveTools()).toEqual([...EXACT_TOOL_NAMES]);

    const inspectResult = await tool(
      fake.tools,
      "inspect_figma",
    ).execute(
      "inspect",
      {
        schemaVersion: "1",
        projectId: "demo-project",
        figmaUrl: "https://www.figma.com/design/AbCdEf1234567890/Demo",
      },
      undefined,
      undefined,
      context,
    );
    expect(inspectResult.details.designBundleRevision).toBe(1);
    expect([
      inspectResult.content[0].type,
      inspectResult.content[1].type,
      inspectResult.content[2].type,
    ]).toEqual(["text", "text", "image"]);

    const loadResult = await tool(
      fake.tools,
      "load_ui_spec",
    ).execute(
      "load",
      {
        schemaVersion: "1",
        projectId: "demo-project",
      },
      undefined,
      undefined,
      context,
    );
    expect(loadResult.details.revision).toBe(1);

    const saveTool = tool(fake.tools, "save_ui_spec");
    const renderTool = tool(fake.tools, "render_and_compare");
    const renderSignal = new AbortController().signal;
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const iterationDraft = structuredClone(uiSpecDraft);
      const iterationTitle = iterationDraft.nodes.find(
        (node) => node.id === "title",
      );
      if (iterationTitle?.kind === "text") {
        iterationTitle.text = `设计预览 ${iteration}`;
      }
      const saveResult = await saveTool.execute(
        `save-${iteration}`,
        {
          schemaVersion: "1",
          projectId: "demo-project",
          baseRevision: iteration,
          reason: `iteration-${iteration}`,
          uiSpec: iterationDraft,
        },
        undefined,
        undefined,
        context,
      );
      expect(saveResult.details.validation.schemaValid).toBe(true);
      await fake.emit("turn_start", {}, context);
      const renderResult = await renderTool.execute(
        `render-${iteration}`,
        {
          schemaVersion: "1",
          projectId: "demo-project",
          comparison: {
            maxDiffPixelRatio: 0.1,
            maxDiffPixels: 100,
            timeoutMs: 10_000,
          },
        },
        iteration === 0 ? renderSignal : undefined,
        undefined,
        context,
      );
      expect(renderResult.details.passed).toBe(false);
      await fake.emit("turn_start", {}, context);
    }
    expect(renderMock.mock.calls[0]![1]).toBe(renderSignal);

    await expect(
      saveTool.execute(
        "save-4",
        {
          schemaVersion: "1",
          projectId: "demo-project",
          baseRevision: 3,
          reason: "iteration-4",
          uiSpec: uiSpecDraft,
        },
        undefined,
        undefined,
        context,
      ),
    ).rejects.toThrow(/bounded_loop_violation/);

    await fake.emit("input", {}, context);
    await fake.emit("turn_start", {}, context);
    const repeatedDraft = structuredClone(uiSpecDraft);
    await saveTool.execute(
      "save-repeat-1",
      {
        schemaVersion: "1",
        projectId: "demo-project",
        baseRevision: 3,
        reason: "repeat-1",
        uiSpec: repeatedDraft,
      },
      undefined,
      undefined,
      context,
    );
    await fake.emit("turn_start", {}, context);
    await renderTool.execute(
      "render-repeat-1",
      {
        schemaVersion: "1",
        projectId: "demo-project",
        comparison: {
          maxDiffPixelRatio: 0.1,
          maxDiffPixels: 100,
          timeoutMs: 10_000,
        },
      },
      undefined,
      undefined,
      context,
    );
    await fake.emit("turn_start", {}, context);
    await expect(
      saveTool.execute(
        "save-repeat-2",
        {
          schemaVersion: "1",
          projectId: "demo-project",
          baseRevision: 4,
          reason: "repeat-2",
          uiSpec: repeatedDraft,
        },
        undefined,
        undefined,
        context,
      ),
    ).rejects.toThrow(/bounded_loop_no_progress/);

    await fake.emit("input", {}, context);
    await fake.emit("turn_start", {}, context);
    const passingDraft = structuredClone(uiSpecDraft);
    const passingTitle = passingDraft.nodes.find(
      (node) => node.id === "title",
    );
    if (passingTitle?.kind === "text") {
      passingTitle.text = "通过候选";
    }
    renderMock.mockResolvedValueOnce({
      schemaVersion: "1",
      projectId: "demo-project",
      runId: "passing-run",
      previewUrl: "http://127.0.0.1:4173/",
      passed: true,
      results: [],
    });
    await saveTool.execute(
      "save-passing",
      {
        schemaVersion: "1",
        projectId: "demo-project",
        baseRevision: 4,
        reason: "passing",
        uiSpec: passingDraft,
      },
      undefined,
      undefined,
      context,
    );
    await fake.emit("turn_start", {}, context);
    await renderTool.execute(
      "render-passing",
      {
        schemaVersion: "1",
        projectId: "demo-project",
        comparison: {
          maxDiffPixelRatio: 0.1,
          maxDiffPixels: 100,
          timeoutMs: 10_000,
        },
      },
      undefined,
      undefined,
      context,
    );
    await fake.emit("turn_start", {}, context);
    await expect(
      saveTool.execute(
        "save-after-pass",
        {
          schemaVersion: "1",
          projectId: "demo-project",
          baseRevision: 5,
          reason: "after-pass",
          uiSpec: uiSpecDraft,
        },
        undefined,
        undefined,
        context,
      ),
    ).rejects.toThrow(/bounded_loop_complete/);

    await fake.emit("session_shutdown", {}, context);
    expect(services.inspect).toHaveBeenCalledTimes(1);
    expect(services.inspectSupplement).toHaveBeenCalledTimes(1);
    expect(services.load).toHaveBeenCalledTimes(1);
    expect(services.save).toHaveBeenCalledTimes(5);
    expect(services.render).toHaveBeenCalledTimes(5);
    expect(services.close).toHaveBeenCalledTimes(1);
  });

  it("同一请求内 inspect 失败后阻止重复请求 Figma", async () => {
    const inspectMock = vi
      .fn<ExtensionToolServices["inspect"]>()
      .mockRejectedValueOnce(new Error("Figma REST file 返回 HTTP 429"))
      .mockResolvedValueOnce({
        schemaVersion: "1",
        projectId: "demo-project",
        designBundleRevision: 1,
        pages: [],
        variables: { status: "unavailable_optional", reasonCode: "unknown" },
        warnings: [],
      });
    const services: ExtensionToolServices = {
      inspect: inspectMock,
      load: vi.fn(),
      save: vi.fn(),
      render: vi.fn(),
    };
    const fake = createFakePi();
    createFigmaToUiExtension({ services })(fake.api);
    const context = {
      cwd: "/tmp/figma-to-ui-agent",
      hasUI: false,
      abort: vi.fn(),
    } as unknown as ExtensionContext;
    const inspectTool = tool(fake.tools, "inspect_figma");
    const input = {
      schemaVersion: "1",
      projectId: "demo-project",
      figmaUrl: "https://www.figma.com/design/AbCdEf1234567890/Demo",
    };

    await fake.emit("session_start", {}, context);
    await fake.emit("input", {}, context);
    await expect(
      inspectTool.execute(
        "inspect-failed",
        input,
        undefined,
        undefined,
        context,
      ),
    ).rejects.toThrow(/HTTP 429/);
    await expect(
      inspectTool.execute(
        "inspect-repeat",
        input,
        undefined,
        undefined,
        context,
      ),
    ).rejects.toThrow(/bounded_loop_inspect_failed/);
    expect(inspectMock).toHaveBeenCalledTimes(1);

    await fake.emit("input", {}, context);
    await expect(
      inspectTool.execute(
        "inspect-next-input",
        input,
        undefined,
        undefined,
        context,
      ),
    ).resolves.toMatchObject({
      details: {
        schemaVersion: "1",
        projectId: "demo-project",
      },
    });
    expect(inspectMock).toHaveBeenCalledTimes(2);
  });
});
