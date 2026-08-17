// pi-lens-ignore: ts:5097
import type { SpecBenchmarkCase } from "./spec-benchmark-cases.ts";

type UnknownRecord = Record<string, unknown>;

export type SpecSignals = {
  routes: number;
  staticRoutes: string[];
  dynamicRoutes: string[];
  layouts: number;
  links: number;
  eventBindings: number;
  statefulTrees: number;
  formControls: number;
};

export type SpecQuality = {
  requirementCoverage: number;
  structuralCoverage: number;
  automatedQualityScore: number;
  requirements: Array<{ id: string; label: string; matched: boolean }>;
  structure: Array<{
    id: keyof SpecBenchmarkCase["minimums"];
    actual: number;
    minimum: number;
    passed: boolean;
  }>;
  signals: SpecSignals;
};

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function elementTrees(spec: UnknownRecord): UnknownRecord[] {
  const trees: UnknownRecord[] = [];
  const layouts = record(spec.layouts);
  if (layouts) {
    for (const layout of Object.values(layouts)) {
      const tree = record(layout);
      if (tree) trees.push(tree);
    }
  }
  const routes = record(spec.routes);
  if (routes) {
    for (const routeValue of Object.values(routes)) {
      const route = record(routeValue);
      if (!route) continue;
      for (const key of ["page", "loading", "error", "notFound"]) {
        const tree = record(route[key]);
        if (tree) trees.push(tree);
      }
    }
  }
  return trees;
}

export function extractSpecSignals(value: unknown): SpecSignals {
  const spec = record(value) ?? {};
  const routes = record(spec.routes) ?? {};
  const routeKeys = Object.keys(routes);
  const trees = elementTrees(spec);
  let links = 0;
  let eventBindings = 0;
  let formControls = 0;
  let statefulTrees = record(spec.state) && Object.keys(record(spec.state)!).length > 0 ? 1 : 0;
  for (const tree of trees) {
    const state = record(tree.state);
    if (state && Object.keys(state).length > 0) statefulTrees += 1;
    const elements = record(tree.elements) ?? {};
    for (const elementValue of Object.values(elements)) {
      const element = record(elementValue);
      if (!element) continue;
      if (element.type === "Link") links += 1;
      if (["Input", "Textarea", "Select", "Checkbox", "Switch", "RadioGroup"].includes(String(element.type))) {
        formControls += 1;
      }
      const on = record(element.on);
      if (on) eventBindings += Object.keys(on).length;
    }
  }
  return {
    routes: routeKeys.length,
    staticRoutes: routeKeys.filter((route) => !route.includes("[")),
    dynamicRoutes: routeKeys.filter((route) => route.includes("[")),
    layouts: Object.keys(record(spec.layouts) ?? {}).length,
    links,
    eventBindings,
    statefulTrees,
    formControls,
  };
}

export function evaluateSpecQuality(
  value: unknown,
  benchmarkCase: SpecBenchmarkCase,
): SpecQuality {
  const haystack = JSON.stringify(value).normalize("NFC").toLocaleLowerCase("zh-CN");
  const requirements = benchmarkCase.requirements.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    matched: requirement.terms.some((term) =>
      haystack.includes(term.normalize("NFC").toLocaleLowerCase("zh-CN")),
    ),
  }));
  const signals = extractSpecSignals(value);
  const structure = (Object.entries(benchmarkCase.minimums) as Array<[
    keyof SpecBenchmarkCase["minimums"],
    number,
  ]>).map(([id, minimum]) => ({
    id,
    actual: signals[id],
    minimum,
    passed: signals[id] >= minimum,
  }));
  const requirementCoverage = requirements.length === 0
    ? 1
    : requirements.filter((item) => item.matched).length / requirements.length;
  const structuralCoverage = structure.length === 0
    ? 1
    : structure.filter((item) => item.passed).length / structure.length;
  return {
    requirementCoverage,
    structuralCoverage,
    automatedQualityScore: requirementCoverage * 0.7 + structuralCoverage * 0.3,
    requirements,
    structure,
    signals,
  };
}
