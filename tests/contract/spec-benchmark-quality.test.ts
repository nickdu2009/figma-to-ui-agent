import { describe, expect, it } from "vitest";

import {
  evaluateSpecQuality,
  extractSpecSignals,
  // pi-lens-ignore: ts:5097
} from "../../server/benchmark/spec-benchmark-quality.ts";
// pi-lens-ignore: ts:5097
import { SPEC_BENCHMARK_CASES } from "../../server/benchmark/spec-benchmark-cases.ts";

const interactiveTodo = {
  state: { tasks: [] },
  layouts: {
    root: {
      root: "nav",
      elements: {
        nav: { type: "Stack", props: {}, children: ["home", "settings", "slot"] },
        home: { type: "Link", props: { href: "/" }, children: [] },
        settings: { type: "Link", props: { href: "/settings" }, children: [] },
        slot: { type: "Slot", props: {}, children: [] },
      },
    },
  },
  routes: {
    "/": {
      page: {
        root: "root",
        state: { filter: "全部" },
        elements: {
          root: { type: "Stack", props: {}, children: ["input", "add", "done", "remove"] },
          input: { type: "Input", props: { label: "任务" }, children: [] },
          add: { type: "Button", props: { label: "添加任务" }, on: { click: { action: "pushState" } } },
          done: { type: "Button", props: { label: "完成" }, on: { click: { action: "setState" } } },
          remove: { type: "Button", props: { label: "删除" }, on: { click: { action: "removeState" } } },
          filter: { type: "Button", props: { label: "未完成" }, on: { click: { action: "setState" } } },
        },
      },
    },
    "/settings": {
      page: {
        root: "settings",
        elements: { settings: { type: "Text", props: { text: "设置" } } },
      },
    },
  },
};

describe("spec benchmark quality", () => {
  it("extracts route, navigation, state, form and event signals", () => {
    expect(extractSpecSignals(interactiveTodo)).toMatchObject({
      routes: 2,
      staticRoutes: ["/", "/settings"],
      dynamicRoutes: [],
      layouts: 1,
      links: 2,
      eventBindings: 4,
      statefulTrees: 2,
      formControls: 1,
    });
  });

  it("scores the requested Todo capabilities independently from catalog validity", () => {
    const todo = SPEC_BENCHMARK_CASES.find((item) => item.id === "todo")!;
    const quality = evaluateSpecQuality(interactiveTodo, todo);
    expect(quality.requirementCoverage).toBe(1);
    expect(quality.structuralCoverage).toBe(1);
    expect(quality.automatedQualityScore).toBe(1);
  });

  it("makes missing interaction and page coverage visible", () => {
    const todo = SPEC_BENCHMARK_CASES.find((item) => item.id === "todo")!;
    const quality = evaluateSpecQuality({ routes: { "/": { page: { root: "x", elements: {} } } } }, todo);
    expect(quality.requirementCoverage).toBe(0);
    expect(quality.structuralCoverage).toBe(0);
  });
});
