#!/usr/bin/env node
/**
 * DS-GATE-00 / DSG-06：LiteLLM 真实 transport 探针（未授权不执行）。
 *
 * ⚠️ 停止条件：本脚本涉及真实 LiteLLM/厂商模型 transport。运行前必须
 * 取得单独授权（见目标提示“未授权动作”清单：真实 LiteLLM、厂商模型或
 * 真实 LLM transport probe）。
 *
 * 双重护栏（缺一即拒绝启动）：
 *  1. 环境变量 VMA_GATE00_LITELLM_AUTHORIZED=1（显式授权标记）
 *  2. 环境变量 VMA_LITELLM_BASE_URL（真实 LiteLLM 网关地址）
 *
 * 凭据只从服务端进程环境读取（VMA_LITELLM_API_KEY）；本脚本不把
 * 凭据、原始内容或路径写入任何日志或输出文件。
 *
 * 运行（须先取得单独授权）：
 *   VMA_GATE00_LITELLM_AUTHORIZED=1 \
 *   VMA_LITELLM_BASE_URL=https://<litellm>/v1 \
 *   VMA_LITELLM_API_KEY=<server-side-key> \
 *   node scripts/ds-gate-00/litellm-transport-probe.ts
 */
import process from "node:process";

if (
  process.env.VMA_GATE00_LITELLM_AUTHORIZED !== "1" ||
  !process.env.VMA_LITELLM_BASE_URL
) {
  console.error(
    "[litellm-probe] BLOCKED: 真实 LiteLLM transport probe 需要单独授权。\n" +
      "  需要同时设置：VMA_GATE00_LITELLM_AUTHORIZED=1 与 VMA_LITELLM_BASE_URL。\n" +
      "  未授权时该子门（DSG-06）保持 unverified，DS-GATE-00 不得标记通过。",
  );
  process.exit(2);
}

const baseUrl = process.env.VMA_LITELLM_BASE_URL;
// 兼容项目既有服务端凭据名；VMA_LITELLM_API_KEY 优先，回退不写回环境也不输出。
const apiKey = process.env.VMA_LITELLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "";

interface ProbeResult {
  step: string;
  ok: boolean;
  httpStatus?: number;
  detail?: string;
}

const results: ProbeResult[] = [];

function record(step: string, ok: boolean, extra?: Partial<ProbeResult>) {
  // 脱敏：不记录 URL 查询串、鉴权头或响应正文。
  const entry: ProbeResult = { step, ok, ...extra };
  results.push(entry);
}

// ---------------------------------------------------------------------------
// L1：基础连接（/models 只读探测）
// ---------------------------------------------------------------------------
{
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    record("l1_models", res.ok, { httpStatus: res.status });
  } catch (error) {
    record("l1_models", false, {
      detail: error instanceof Error ? error.name : "fetch_failed",
    });
  }
}

// ---------------------------------------------------------------------------
// L2：流式 chat completion（真实 transport，测首 token 延迟与流完整性）
// 模型名从环境读取（VMA_LITELLM_PROBE_MODEL，默认 gpt-4o-mini 占位，
// 由授权方指定真实模型）。
// ---------------------------------------------------------------------------
{
  const model = process.env.VMA_LITELLM_PROBE_MODEL ?? "";
  if (model) {
    try {
      const t0 = performance.now();
      const res = await fetch(
        `${baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            stream: true,
            max_tokens: 32,
            messages: [
              { role: "user", content: "Reply with the single word: ready" },
            ],
          }),
        },
      );
      if (!res.ok || !res.body) {
        record("l2_stream", false, { httpStatus: res.status });
      } else {
        const reader = res.body.getReader();
        let chunks = 0;
        let firstChunkAt: number | null = null;
        let done = false;
        while (!done) {
          const { value, done: streamDone } = await reader.read();
          if (value) {
            chunks++;
            if (firstChunkAt === null) firstChunkAt = performance.now() - t0;
          }
          done = streamDone;
        }
        record("l2_stream", chunks > 0, {
          detail: `chunks=${chunks} firstChunkMs=${firstChunkAt?.toFixed(0)}`,
        });
      }
    } catch (error) {
      record("l2_stream", false, {
        detail: error instanceof Error ? error.name : "fetch_failed",
      });
    }
  } else {
    record("l2_stream", false, { detail: "VMA_LITELLM_PROBE_MODEL unset" });
  }
}

// ---------------------------------------------------------------------------
// L3：非流式结构化输出（response_format=json_object）
// ---------------------------------------------------------------------------
{
  const model = process.env.VMA_LITELLM_PROBE_MODEL ?? "";
  if (model) {
    try {
      const res = await fetch(
        `${baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            max_tokens: 64,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "user",
                content: 'Return {"ok": true} as JSON.',
              },
            ],
          }),
        },
      );
      record("l3_structured", res.ok, { httpStatus: res.status });
    } catch (error) {
      record("l3_structured", false, {
        detail: error instanceof Error ? error.name : "fetch_failed",
      });
    }
  } else {
    record("l3_structured", false, { detail: "model unset" });
  }
}

console.log(
  JSON.stringify(
    {
      probe: "ds-gate-00/litellm-transport-probe",
      measuredAt: new Date().toISOString(),
      authorized: true,
      results,
    },
    null,
    2,
  ),
);
if (results.some((r) => !r.ok)) process.exitCode = 1;
