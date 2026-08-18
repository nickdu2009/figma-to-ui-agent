import { describe, expect, it } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";

import { GenerationCoordinator } from "../../server/generation-coordinator.ts";
import { CoordinatedMastraAgent } from "../../server/coordinated-mastra-agent.ts";
import { cannedPlan } from "../../server/mock-fixtures.ts";

class ScriptedAgent extends AbstractAgent {
  private readonly script: (runId: string) => BaseEvent[];
  constructor(script: (runId: string) => BaseEvent[]) {
    super({ agentId: "scripted", description: "", debug: false });
    this.script = script;
  }
  clone(): ScriptedAgent {
    return new ScriptedAgent(this.script);
  }
  run(input: RunAgentInput): Observable<BaseEvent> {
    const events = this.script(input.runId);
    return new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      for (const event of events) subscriber.next(event);
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      subscriber.complete();
    });
  }
}

const questions = [
  {
    id: "audience",
    header: "目标用户",
    question: "主要给谁使用？",
    options: [
      { value: "individual", label: "个人用户", recommended: true },
      { value: "team", label: "团队" },
    ],
  },
  {
    id: "scope",
    header: "首版范围",
    question: "首版做到哪一档？",
    options: [
      { value: "mvp", label: "标准 MVP", recommended: true },
      { value: "minimal", label: "极简清单" },
    ],
    allowCustom: true,
    allowSkip: true,
  },
];

function questionCallScript(args: unknown) {
  return (runId: string): BaseEvent[] => {
    const toolCallId = `${runId}-question`;
    return [
      {
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName: "ask_question",
      } as BaseEvent,
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: JSON.stringify(args),
      } as BaseEvent,
      { type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent,
    ];
  };
}

function collect(
  agent: CoordinatedMastraAgent,
  input: Partial<RunAgentInput> & { threadId: string; runId: string },
) {
  const complete = {
    messages: [],
    tools: [],
    context: [],
    state: {},
    ...input,
  } as RunAgentInput;
  return new Promise<BaseEvent[]>((resolve, reject) => {
    const events: BaseEvent[] = [];
    agent
      .run(complete)
      .subscribe({
        next: (event) => events.push(event),
        error: reject,
        complete: () => resolve(events),
      });
  });
}

describe("ask_question contract", () => {
  it("服务端签发 questionSetId，普通消息保留计划，interrupt 携带多题元数据", async () => {
    const coordinator = new GenerationCoordinator();
    const agent = new CoordinatedMastraAgent(
      new ScriptedAgent(
        questionCallScript({
          message: "先确认两个关键选择",
          questionSetId: "forged",
          questions,
          plan: cannedPlan,
        }),
      ),
      coordinator,
      { agentId: "chat" },
    );
    const events = await collect(agent, { threadId: "t1", runId: "r1" });
    const args = events.find(
      (event) => event.type === EventType.TOOL_CALL_ARGS,
    ) as unknown as { delta: string };
    expect(JSON.parse(args.delta).questionSetId).toBe("q-r1-r1-question");
    const transcript = events.find(
      (event) => event.type === EventType.TEXT_MESSAGE_CONTENT,
    ) as unknown as { delta: string };
    expect(transcript.delta).toContain(cannedPlan.goal);
    expect(transcript.delta).toContain("2 个问题");
    const finished = events.find(
      (event) => event.type === EventType.RUN_FINISHED,
    ) as {
      outcome?: {
        interrupts: Array<{
          reason: string;
          metadata?: { questions?: unknown[] };
        }>;
      };
    };
    expect(finished.outcome?.interrupts[0]?.reason).toBe("ask_question");
    expect(finished.outcome?.interrupts[0]?.metadata?.questions).toHaveLength(
      2,
    );
    expect(coordinator.snapshot().questions).toHaveLength(1);
  });

  it("answers 必须完整、唯一且在选项集合内；approve 只可消费一次计划", async () => {
    const coordinator = new GenerationCoordinator();
    const agent = new CoordinatedMastraAgent(
      new ScriptedAgent(
        questionCallScript({
          message: "确认计划",
          questions: [
            {
              id: "confirm",
              header: "确认",
              question: "开始生成？",
              options: [
                { value: "approve", label: "开始生成" },
                { value: "revise", label: "调整" },
              ],
            },
          ],
          plan: cannedPlan,
        }),
      ),
      coordinator,
      { agentId: "chat" },
    );
    await collect(agent, { threadId: "t2", runId: "r1" });
    await collect(agent, {
      threadId: "t2",
      runId: "r2",
      messages: [
        {
          role: "tool",
          toolCallId: "r1-question",
          content: JSON.stringify({
            answers: [{ questionId: "confirm", value: "forged" }],
          }),
        },
      ] as never,
    });
    expect(
      await coordinator.consumeApprovedPlan("t2", "q-r1-r1-question"),
    ).toBeNull();
    await collect(agent, {
      threadId: "t2",
      runId: "r3",
      messages: [
        {
          role: "tool",
          toolCallId: "r1-question",
          content: JSON.stringify({
            answers: [{ questionId: "confirm", value: "approve" }],
          }),
        },
      ] as never,
    });
    expect(
      await coordinator.consumeApprovedPlan("t2", "q-r1-r1-question"),
    ).toEqual(cannedPlan);
    expect(
      await coordinator.consumeApprovedPlan("t2", "q-r1-r1-question"),
    ).toBeNull();
  });

  it("resume 会将多题 answers 合成为工具消息并剥离 resume", async () => {
    const coordinator = new GenerationCoordinator();
    const seed = new CoordinatedMastraAgent(
      new ScriptedAgent(questionCallScript({ message: "澄清", questions })),
      coordinator,
      { agentId: "chat" },
    );
    await collect(seed, { threadId: "t3", runId: "r1" });
    let received: RunAgentInput | null = null;
    class Receiver extends AbstractAgent {
      constructor() {
        super({ agentId: "receiver", description: "", debug: false });
      }
      clone() {
        return new Receiver();
      }
      run(input: RunAgentInput) {
        received = input;
        return new Observable<BaseEvent>((subscriber) => {
          subscriber.next({
            type: EventType.RUN_STARTED,
            threadId: input.threadId,
            runId: input.runId,
          } as BaseEvent);
          subscriber.next({
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
          } as BaseEvent);
          subscriber.complete();
        });
      }
    }
    const receiver = new CoordinatedMastraAgent(new Receiver(), coordinator, {
      agentId: "chat",
    });
    await collect(receiver, {
      threadId: "t3",
      runId: "r2",
      resume: [
        {
          status: "resolved",
          interruptId: "r1::r1-question",
          payload: {
            answers: [
              { questionId: "audience", value: "individual" },
              { questionId: "scope", value: "mvp" },
            ],
          },
        },
      ],
    } as never);
    const input = received as unknown as RunAgentInput & { resume?: unknown };
    const tool = input.messages.find((message) => message.role === "tool");
    expect(input.resume).toBeUndefined();
    expect(JSON.parse(String(tool?.content))).toEqual({
      answers: [
        { questionId: "audience", value: "individual" },
        { questionId: "scope", value: "mvp" },
      ],
    });
  });
});
