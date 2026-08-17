import { describe, expect, it } from "vitest";

import {
  createReasoningSummaryObserver,
  // pi-lens-ignore: ts:5097
} from "../../server/benchmark/spec-benchmark-reasoning-output.ts";

describe("spec benchmark reasoning summary output", () => {
  it("prints only reasoning summary chunks", () => {
    const output: string[] = [];
    const observe = createReasoningSummaryObserver("model", (value) => output.push(value));
    observe({ type: "text-delta", payload: { text: "hidden spec" } });
    observe({ type: "tool-input-delta", payload: { text: "hidden tool input" } });
    observe({ type: "reasoning-start", payload: { id: "r1" } });
    observe({ type: "reasoning-delta", payload: { id: "r1", text: "summary" } });
    observe({ type: "reasoning-end", payload: { id: "r1" } });
    expect(output.join("")).toBe(
      "\n[reasoning-summary:model]\nsummary\n[/reasoning-summary]\n",
    );
  });

  it("bounds the total reasoning text", () => {
    const output: string[] = [];
    const observe = createReasoningSummaryObserver("model", (value) => output.push(value), 5);
    observe({ type: "reasoning-delta", payload: { text: "123456789" } });
    observe({ type: "reasoning-delta", payload: { text: "ignored" } });
    expect(output.join("")).toBe("12345\n[reasoning summary truncated]\n");
  });
});
