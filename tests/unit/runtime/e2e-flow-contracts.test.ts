import { describe, expect, it } from "vitest";

import {
  m7ExitCode,
  m7RunRequestSchema,
  m7RunResultSchema,
  redactM7Secrets,
} from "../../../src/runtime/e2e-flow-contracts.ts";

describe("M7 E2E flow contracts", () => {
  it("accepts a local request with an explicit DesignBundle revision", () => {
    const request = m7RunRequestSchema.parse({
      projectId: "m7-demo",
      mode: "local",
      designBundleRevision: 3,
    });

    expect(request.projectId).toBe("m7-demo");
    expect(request.designBundleRevision).toBe(3);
  });

  it("rejects invalid mode and invalid revision", () => {
    expect(() =>
      m7RunRequestSchema.parse({
        projectId: "m7-demo",
        mode: "remote",
      }),
    ).toThrow();
    expect(() =>
      m7RunRequestSchema.parse({
        projectId: "m7-demo",
        mode: "local",
        designBundleRevision: 0,
      }),
    ).toThrow();
  });

  it("accepts fileKey outside local mode", () => {
    const request = m7RunRequestSchema.parse({
      projectId: "m7-demo",
      mode: "restricted-live",
      fileKey: "ScI7ZTAXdjaqUDG1LeRnqd",
      nodeId: "2-2",
    });

    expect(request.fileKey).toBe("ScI7ZTAXdjaqUDG1LeRnqd");
  });

  it("requires figmaUrl or fileKey outside local mode", () => {
    expect(() =>
      m7RunRequestSchema.parse({
        projectId: "m7-demo",
        mode: "restricted-live",
      }),
    ).toThrow(/figmaUrl 或 fileKey/);
  });

  it("redacts sensitive values in nested details", () => {
    expect(
      redactM7Secrets({
        FIGMA_API_KEY: "figd_sensitivevalue",
        nested: {
          message: "token sk-sensitivevalue leaked",
        },
      }),
    ).toEqual({
      FIGMA_API_KEY: "[redacted]",
      nested: {
        message: "token [redacted] leaked",
      },
    });
  });

  it("maps stable exit codes", () => {
    const result = m7RunResultSchema.parse({
      schemaVersion: "1",
      ok: false,
      runId: "run-1",
      input: {},
      artifacts: {
        summaryJson: "reports/m7-e2e/run-1/summary.json",
        summaryMarkdown: "reports/m7-e2e/run-1/summary.md",
      },
      steps: [
        {
          id: "validate_input",
          status: "failed",
          message: "bad input",
        },
      ],
      error: {
        category: "input_invalid",
        message: "bad input",
        recoverable: true,
        nextAction: "fix input",
      },
      nextAction: "fix input",
    });

    expect(m7ExitCode(result)).toBe(2);
  });
});
