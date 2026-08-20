/**
 * Prompt 投影契约测试（S1，设计 §10.2、AC4b）：
 * - buildPromptCatalog 覆盖全部 registryKeys、排除 Link/Slot；
 * - 内置动作只进 Prompt 静态约束；catalog.data.actions 只含 10 个 customActions；
 * - Bundle Prompt 片段断言 ApplicationCandidate 根、/ui state、businessSchema:null 语义、
 *   禁止业务样例记录写入 state、Link/Slot 保留；
 * - 片段不包含原生 prompt 的旧 sample-data/root-output 指令。
 */
import { describe, expect, it } from "vitest";

// pi-lens-ignore: ts:5097
import {
  bundlePromptFragment,
  derivedModelCatalog,
  modelPromptCatalog,
} from "../../server/model-catalog.ts";
import {
  buildBundlePromptFragment,
  buildPromptCatalog,
} from "../../server/bundle/prompt-projection.js";

describe("prompt projection", () => {
  it("buildPromptCatalog 覆盖全部组件键并排除 Link/Slot", () => {
    const prompt = buildPromptCatalog(derivedModelCatalog);
    for (const key of derivedModelCatalog.registryKeys) {
      expect(prompt).toContain(`- ${key}:`);
    }
    expect(prompt).not.toContain("- Link:");
    expect(prompt).not.toContain("- Slot:");
    expect(prompt).toContain("- DataTable:");
    expect(prompt).toContain("- AppShell:");
  });

  it("内置动作只在静态约束段，customActions 段独立列出", () => {
    const prompt = buildPromptCatalog(derivedModelCatalog);
    expect(prompt).toContain("## 受控业务 Action");
    expect(prompt).toContain("## 内置 Action（静态约束，不在 catalog.data.actions 中）");
    expect(prompt).toContain("setState / pushState / removeState");
    expect(prompt).toContain("navigate");
    for (const key of derivedModelCatalog.customActionKeys) {
      expect(prompt).toContain(`- ${key}:`);
    }
  });

  it("catalog.actionNames 只含 10 个 customActions", () => {
    expect(derivedModelCatalog.catalog.actionNames).toHaveLength(10);
    expect(derivedModelCatalog.catalog.actionNames).not.toContain("setState");
    expect(derivedModelCatalog.catalog.actionNames).not.toContain("navigate");
  });

  it("catalog.componentNames 不含 Link/Slot", () => {
    expect(derivedModelCatalog.catalog.componentNames).not.toContain("Link");
    expect(derivedModelCatalog.catalog.componentNames).not.toContain("Slot");
  });

  it("Bundle Prompt 片段断言 ApplicationCandidate 输出契约（AC4b）", () => {
    const fragment = buildBundlePromptFragment();
    expect(fragment).toContain("ApplicationCandidate");
    expect(fragment).toContain("/uiBundle/spec/**");
    expect(fragment).toContain("/businessSchema");
    expect(fragment).toContain("/migrationPlan/**");
    expect(fragment).toContain("/migrationEdge 由服务端拥有");
    expect(fragment).toContain("/ui");
    expect(fragment).toContain("businessSchema:null 是唯一空业务模型表示");
    expect(fragment).toContain("不得把业务样例记录写入 Bundle state");
    expect(fragment).toContain("Link 与 Slot 由运行时保留");
  });

  it("片段不含原生 prompt 的旧 sample-data/root-output 英文指令", () => {
    const fragment = buildBundlePromptFragment();
    expect(fragment).not.toContain("realistic sample data");
    expect(fragment).not.toContain("root element");
    expect(fragment).not.toContain("sample-data");
  });

  it("model-catalog 导出的投影来自派生 catalog（单一来源）", () => {
    expect(modelPromptCatalog).toBe(buildPromptCatalog(derivedModelCatalog));
    expect(bundlePromptFragment).toBe(buildBundlePromptFragment());
    expect(modelPromptCatalog).toContain("- DataTable:");
    expect(modelPromptCatalog).not.toContain("- Link:");
  });
});
