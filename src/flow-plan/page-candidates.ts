import type { DesignBundle } from "../design-bundle/schema.ts";
import type { UISpec, UISpecDraft } from "../ui-spec/schema.ts";
import {
  FLOW_PLAN_DRAFT_SCHEMA_VERSION,
  type FlowConfidence,
  type FlowPageRole,
  type FlowPlanPage,
} from "./draft.ts";

export interface PageCandidateResult {
  readonly schemaVersion: typeof FLOW_PLAN_DRAFT_SCHEMA_VERSION;
  readonly pages: FlowPlanPage[];
  readonly satisfiesMultipage: boolean;
  readonly insufficientReason?: string;
}

function safeId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "page";
}

function classifyPage(
  page: DesignBundle["pages"][number],
  index: number,
): {
  role: FlowPageRole;
  confidence: FlowConfidence;
  reason: string;
} {
  const name = page.name.toLowerCase();
  if (
    /state|hover|pressed|modal|dialog|success|error|empty|loading|状态|弹窗|成功|失败|空|加载/.test(
      name,
    )
  ) {
    return {
      role: "state",
      confidence: "medium",
      reason: "页面名包含状态或弹层语义，仅作为候选状态页。",
    };
  }
  if (page.width > 0 && page.height > 0 && page.width * page.height < 160_000) {
    return {
      role: "component",
      confidence: "medium",
      reason: "画布面积较小，更像组件或局部状态。",
    };
  }
  if (index === 0) {
    return {
      role: "entry",
      confidence: "medium",
      reason: "DesignBundle 中的首个页面作为入口候选。",
    };
  }
  return {
    role: "screen",
    confidence: "medium",
    reason: "页面尺寸和结构符合独立 screen 候选。",
  };
}

export function identifyPageCandidates(
  bundle: DesignBundle,
  uiSpec?: UISpec | UISpecDraft,
): PageCandidateResult {
  const pageBySourceId = new Map(
    uiSpec?.pages.map((page) => [page.sourcePageId, page]) ?? [],
  );
  const pages = bundle.pages.map((page, index) => {
    const classification = classifyPage(page, index);
    return {
      id: pageBySourceId.get(page.id)?.id ?? safeId(page.name || page.id),
      sourcePageId: page.id,
      name: page.name,
      ...classification,
    };
  });
  return {
    schemaVersion: FLOW_PLAN_DRAFT_SCHEMA_VERSION,
    pages,
    satisfiesMultipage: pages.length >= 2,
    insufficientReason:
      pages.length >= 2
        ? undefined
        : "不满足多页面 Flow 验证条件：DesignBundle 只有一个候选页面。",
  };
}
