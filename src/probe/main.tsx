import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CopilotKit,
  CopilotChat,
  useAgent,
  useInterrupt,
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

type CustomLogEntry = { name: string; at: number; bytes: number };

/** DSG-04：spec.patch.finish 大载荷传输指标（近 2MiB / 超限探针）。 */
type Gate00FinishMetrics = {
  scenario: "probe" | "overflow";
  generationId: string;
  utf8Bytes: number;
  structureOk: boolean;
  firstEventAt: number;
  finishAt: number;
  latencyMs: number;
  heapUsedBefore: number | null;
  heapUsedAfter: number | null;
};

type StreamState = {
  bytes: number;
  finished: boolean;
  waiters: Array<() => void>;
};

/**
 * await_apply_result 的不可见 interrupt 处理器：等待本地应用流关闭后
 * 程序化 resolve，把应用结果作为工具结果随下一次 run 返回。
 */
function AwaitApplyInterrupt(props: {
  streamState: StreamState;
  resolve: (payload?: unknown) => void;
  onResolved: (resultJson: string) => void;
}) {
  const { streamState, resolve, onResolved } = props;
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    const fire = () => {
      if (fired.current) return;
      fired.current = true;
      const result = {
        generationId: "gen-probe",
        status: "committed",
        revision: 1,
        appliedBytes: streamState.bytes,
      };
      onResolved(JSON.stringify(result));
      resolve(result);
    };
    if (streamState.finished) {
      fire();
    } else {
      streamState.waiters.push(fire);
    }
  }, [streamState, resolve, onResolved]);
  return (
    <div data-testid="probe-await-interrupt" style={{ display: "none" }} />
  );
}

/**
 * Transport 探针页面（G1）：
 *  - 文本透传：CopilotChat 直接显示。
 *  - ask_question：useInterrupt 卡片 + resolve。
 *  - spec.patch.* CUSTOM：agent.subscribe 记录到达时间与字节数。
 *  - await_apply_result：interrupt outcome 到达后，浏览器等本地“应用流”关闭，
 *    然后程序化 resolve（探针结论：前端工具自动执行与未决 interrupt 会互相阻塞，
 *    因此 await_apply_result 走 useInterrupt resolve 通道，结果作为绑定
 *    toolCallId 的工具结果随下一次 run 返回）。
 */
function ProbeApp() {
  const [customLog, setCustomLog] = useState<CustomLogEntry[]>([]);
  const [applyResult, setApplyResult] = useState<string>("");
  const [gate00Metrics, setGate00Metrics] =
    useState<Gate00FinishMetrics | null>(null);
  const streamState = useRef<StreamState>({
    bytes: 0,
    finished: false,
    waiters: [],
  });
  const firstCustomAt = useRef<number | null>(null);
  const heapBefore = useRef<number | null>(null);

  const { agent, isReady } = useAgent({ agentId: "probe" });

  useEffect(() => {
    if (!isReady) return;
    const sub = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.type !== "CUSTOM") return;
        const value = (event as { value?: { text?: string } }).value;
        // 新一代 spec.patch.start 到达时重置计时/堆基准（支持多次探针）。
        if (event.name === "spec.patch.start") {
          firstCustomAt.current = performance.now();
          heapBefore.current = null;
        } else if (firstCustomAt.current === null) {
          firstCustomAt.current = performance.now();
        }
        const bytes = value?.text
          ? new TextEncoder().encode(value.text).length
          : 0;
        setCustomLog((prev) => [
          ...prev,
          { name: event.name, at: performance.now(), bytes },
        ]);
        if (event.name === "spec.patch.delta") {
          streamState.current.bytes += bytes;
        }
        if (event.name === "spec.patch.finish") {
          streamState.current.finished = true;
          for (const resolve of streamState.current.waiters.splice(0))
            resolve();
          // DSG-04：记录大载荷 finish 的传输指标。
          const gate00 = (
            value as { __gate00?: "probe" | "overflow" } | undefined
          )?.__gate00;
          if (gate00 && value) {
            const memory = (
              performance as Performance & {
                memory?: { usedJSHeapSize: number };
              }
            ).memory;
            if (heapBefore.current === null && memory) {
              heapBefore.current = memory.usedJSHeapSize;
            }
            const finishValue = value as Record<string, unknown>;
            const ui = finishValue.ui as { padding?: string } | undefined;
            setGate00Metrics({
              scenario: gate00,
              generationId: String(finishValue.generationId ?? ""),
              utf8Bytes: new TextEncoder().encode(JSON.stringify(value)).length,
              structureOk:
                finishValue.schemaVersion === 2 &&
                typeof ui?.padding === "string" &&
                ui.padding.length > 1_000_000,
              firstEventAt: firstCustomAt.current ?? 0,
              finishAt: performance.now(),
              latencyMs:
                performance.now() -
                (firstCustomAt.current ?? performance.now()),
              heapUsedBefore: heapBefore.current,
              heapUsedAfter: memory?.usedJSHeapSize ?? null,
            });
          }
        }
      },
    });
    return () => sub.unsubscribe();
  }, [agent, isReady]);

  useInterrupt({
    agentId: "probe",
    render: ({ interrupt, resolve }) => {
      if (interrupt?.reason === "await_apply") {
        return (
          <AwaitApplyInterrupt
            streamState={streamState.current}
            resolve={resolve}
            onResolved={setApplyResult}
          />
        );
      }
      return (
        <div data-testid="probe-interrupt">
          <span>probe decision required</span>
          <button
            data-testid="probe-approve"
            onClick={() =>
              resolve({
                answers: [{ questionId: "continue", value: "continue" }],
              })
            }
          >
            approve
          </button>
        </div>
      );
    },
  });

  return (
    <div>
      <div data-testid="probe-custom-log">
        {customLog.map((e, i) => (
          <div key={i} data-name={e.name} data-at={e.at} data-bytes={e.bytes} />
        ))}
      </div>
      <div data-testid="probe-apply-result">{applyResult}</div>
      {gate00Metrics ? (
        <div data-testid="gate00-finish-metrics">
          {JSON.stringify(gate00Metrics)}
        </div>
      ) : null}
      <CopilotChat agentId="probe" />
    </div>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("missing #root");

createRoot(container).render(
  <StrictMode>
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <ProbeApp />
    </CopilotKit>
  </StrictMode>,
);
