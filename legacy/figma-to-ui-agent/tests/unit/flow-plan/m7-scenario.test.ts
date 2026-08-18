import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseFlowM7BehaviorScenario,
} from "../../../src/flow-plan/m7-scenario.ts";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(resolve("tests/fixtures/flow-plan", name), "utf8"),
  );
}

describe("Flow-M7 behavior scenario", () => {
  it("接受 expect_value、expect_checked 和 submit-like postcondition", async () => {
    const parsed = parseFlowM7BehaviorScenario(
      await fixture("m7-interactive-scenario.json"),
    );

    expect(parsed.fixtures.map((item) => item.id)).toEqual([
      "m7-form-fill",
      "m7-form-toggle",
      "m7-submit-like",
    ]);
    expect(parsed.submitLikeExpectations).toEqual([
      {
        fixtureId: "m7-submit-like",
        clickNodeId: "submit-button",
        convertedActionId: "flow-figma-submit",
      },
    ]);
  });

  it("拒绝没有 click 后 postcondition 的 submit-like fixture", () => {
    expect(() =>
      parseFlowM7BehaviorScenario({
        schemaVersion: "1",
        projectId: "demo-project",
        fixtures: [
          {
            id: "bad-submit",
            name: "bad",
            viewportId: "desktop",
            initialPageId: "home",
            steps: [{ kind: "click", nodeId: "submit-button" }],
          },
        ],
        submitLikeExpectations: [
          {
            fixtureId: "bad-submit",
            clickNodeId: "submit-button",
          },
        ],
      }),
    ).toThrow(/postcondition/);
  });
});
