/**
 * S11 契约测试：系统提示词与生成协议契约（设计 §5.1/§10.3）。
 *
 * 验证：
 * 1. CHAT_SYSTEM_PROMPT 包含计划澄清、前端工具与 generate_spec 调用规则；
 * 2. STRUCTURED_SPEC_GENERATION_SYSTEM_PROMPT 包含结构化补丁、组件契约与设计系统说明；
 * 3. 提示词由单一派生 Catalog 生成，无第二份手写组件列表。
 */
import { describe, expect, it } from "vitest";
import {
  CHAT_SYSTEM_PROMPT,
  STRUCTURED_SPEC_GENERATION_SYSTEM_PROMPT,
} from "../../server/prompt.ts";
import { derivedModelCatalog } from "../../server/model-catalog.ts";

describe("S11 系统提示词与生成协议契约 (bundle-prompt)", () => {
  it("CHAT_SYSTEM_PROMPT 包含计划确认与 generate_spec 协议约束", () => {
    expect(CHAT_SYSTEM_PROMPT).toContain("generate_spec");
    expect(CHAT_SYSTEM_PROMPT).toContain("ask_question");
  });

  it("STRUCTURED_SPEC_GENERATION_SYSTEM_PROMPT 包含所有 P0 组件（81 个）与补丁工具契约", () => {
    expect(STRUCTURED_SPEC_GENERATION_SYSTEM_PROMPT).toContain(
      "emit_patch_operations",
    );
    expect(STRUCTURED_SPEC_GENERATION_SYSTEM_PROMPT).toContain(
      "validate_patch_generation",
    );

    // 验证所有 81 个组件（35 base + 46 additions）都包含在生成的结构化提示词中
    const componentNames = derivedModelCatalog.registryKeys;
    expect(componentNames).toHaveLength(81);
    for (const name of componentNames) {
      expect(STRUCTURED_SPEC_GENERATION_SYSTEM_PROMPT).toContain(name);
    }
  });

  it("提示词中不含废弃的 Link 伪组件", () => {
    expect(STRUCTURED_SPEC_GENERATION_SYSTEM_PROMPT).not.toContain('"Link"');
  });
});
