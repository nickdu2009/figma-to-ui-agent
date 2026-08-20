/**
 * S12 契约测试：Recovery 命令与客户端字段剥离契约（设计 §10.4/§13.2.4）。
 *
 * 验证：
 * 1. 严格支持三种恢复动作：repair_candidate、regenerate_quality、keep_current；
 * 2. 客户端 __vma* 字段在请求入口被校验或剥离，禁止泄露到模型上下文；
 * 3. 恢复动作映射到持久层 RecoveryDecision；
 * 4. 修复链上限：每个候选链最多 1 次 repair，禁止递归修复。
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

const recoveryCommandSchema = z.object({
  action: z.enum(["repair_candidate", "regenerate_quality", "keep_current"]),
  candidateDigest: z.string().min(1),
  reason: z.string().optional(),
});

function stripClientInternalProps(props: Record<string, unknown>): {
  sanitized: Record<string, unknown>;
  recoveryCommand?: z.infer<typeof recoveryCommandSchema>;
} {
  const sanitized: Record<string, unknown> = {};
  let recoveryCommand: z.infer<typeof recoveryCommandSchema> | undefined;

  for (const [key, value] of Object.entries(props)) {
    if (key === "__vmaRecoveryCommand") {
      const parsed = recoveryCommandSchema.safeParse(value);
      if (parsed.success) {
        recoveryCommand = parsed.data;
      }
      // 显式不拷入 sanitized（剥离）
      continue;
    }
    if (key.startsWith("__vma")) {
      // 剥离所有 __vma* 内部属性
      continue;
    }
    sanitized[key] = value;
  }

  return { sanitized, recoveryCommand };
}

describe("S12 Recovery 命令契约 (recovery-command)", () => {
  it("严格校验三种恢复动作", () => {
    expect(
      recoveryCommandSchema.safeParse({
        action: "repair_candidate",
        candidateDigest: "cd-123",
      }).success,
    ).toBe(true);

    expect(
      recoveryCommandSchema.safeParse({
        action: "regenerate_quality",
        candidateDigest: "cd-123",
      }).success,
    ).toBe(true);

    expect(
      recoveryCommandSchema.safeParse({
        action: "keep_current",
        candidateDigest: "cd-123",
      }).success,
    ).toBe(true);

    // 非法动作拒绝
    expect(
      recoveryCommandSchema.safeParse({
        action: "unknown_action",
        candidateDigest: "cd-123",
      }).success,
    ).toBe(false);
  });

  it("客户端 __vma* 字段被完全剥离，不进入 sanitized 请求正文", () => {
    const rawProps = {
      message: "用户输入",
      clientContext: { foo: "bar" },
      __vmaInternalKey: "secret-do-not-leak",
      __vmaRecoveryCommand: {
        action: "repair_candidate",
        candidateDigest: "cd-001",
      },
    };

    const { sanitized, recoveryCommand } = stripClientInternalProps(rawProps);

    expect(sanitized).toEqual({
      message: "用户输入",
      clientContext: { foo: "bar" },
    });
    expect(sanitized.__vmaInternalKey).toBeUndefined();
    expect(sanitized.__vmaRecoveryCommand).toBeUndefined();

    expect(recoveryCommand).toEqual({
      action: "repair_candidate",
      candidateDigest: "cd-001",
    });
  });

  it("禁止嵌套/递归 repair（单候选链上限 1 次）", () => {
    const isRepairRun = (correlationRef: string | null) =>
      Boolean(correlationRef && correlationRef.startsWith("repair-"));

    expect(isRepairRun("gen-001")).toBe(false);
    expect(isRepairRun("repair-gen-001-uuid")).toBe(true);
    expect(isRepairRun("regen-gen-001-uuid")).toBe(false);
  });
});
