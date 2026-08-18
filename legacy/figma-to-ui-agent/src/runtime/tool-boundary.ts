import type {
  ExtensionAPI,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";

export const TOOL_SCHEMA_VERSION = "1" as const;

export const EXACT_TOOL_NAMES = [
  "inspect_figma",
  "load_ui_spec",
  "save_ui_spec",
  "render_and_compare",
] as const;

export type ExactToolName = (typeof EXACT_TOOL_NAMES)[number];

type ToolBoundaryApi = Pick<
  ExtensionAPI,
  "getActiveTools" | "getAllTools" | "setActiveTools"
>;

function normalizedNames(names: readonly string[]): string[] {
  return [...names].sort((left, right) => left.localeCompare(right));
}

export function assertExactToolNames(
  actual: readonly string[],
  phase: string,
): void {
  const expected = normalizedNames(EXACT_TOOL_NAMES);
  const normalizedActual = normalizedNames(actual);
  const hasDuplicates = new Set(actual).size !== actual.length;

  if (
    hasDuplicates ||
    expected.length !== normalizedActual.length ||
    expected.some((name, index) => name !== normalizedActual[index])
  ) {
    throw new Error(
      `tool_boundary_violation:${phase}:expected=${expected.join(",")}:actual=${normalizedActual.join(",")}`,
    );
  }
}

export function assertToolInventory(
  tools: readonly ToolInfo[],
  phase: string,
): void {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  for (const name of EXACT_TOOL_NAMES) {
    const tool = byName.get(name);
    if (!tool) {
      throw new Error(`tool_inventory_missing:${phase}:${name}`);
    }

    if (
      tool.sourceInfo.source === "builtin" ||
      tool.sourceInfo.source === "sdk"
    ) {
      throw new Error(
        `tool_inventory_source_invalid:${phase}:${name}:${tool.sourceInfo.source}`,
      );
    }
  }
}

export function assertToolBoundary(
  pi: ToolBoundaryApi,
  phase: string,
): void {
  assertToolInventory(pi.getAllTools(), phase);
  assertExactToolNames(pi.getActiveTools(), phase);
}

export function configureToolBoundary(
  pi: ToolBoundaryApi,
  phase: string,
): void {
  pi.setActiveTools([...EXACT_TOOL_NAMES]);
  assertToolBoundary(pi, phase);
}

export function extractProviderToolNames(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    throw new Error("provider_payload_invalid:not_object");
  }

  const tools = Reflect.get(payload, "tools");
  if (!Array.isArray(tools)) {
    throw new Error("provider_payload_invalid:tools_missing");
  }

  const names = tools.map((tool, index) => {
    if (!tool || typeof tool !== "object") {
      throw new Error(`provider_payload_invalid:tool_${index}_not_object`);
    }

    const directName = Reflect.get(tool, "name");
    if (typeof directName === "string") {
      return directName;
    }

    const fn = Reflect.get(tool, "function");
    if (fn && typeof fn === "object") {
      const functionName = Reflect.get(fn, "name");
      if (typeof functionName === "string") {
        return functionName;
      }
    }

    throw new Error(`provider_payload_invalid:tool_${index}_name_missing`);
  });

  assertExactToolNames(names, "before_provider_request");
  return names;
}
