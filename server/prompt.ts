import { modelCatalog } from "./model-catalog.ts";

// 注：服务端以 Node 24 类型剥离直接运行，相对导入必须显式 .ts 扩展名
//（tsconfig 已启用 allowImportingTsExtensions；tsc --noEmit 通过）。

/**
 * 聊天 Agent 的系统 Prompt：普通问答、读取当前状态、规划/澄清/确认、调用
 * generate_spec。不携带组件目录，不输出 Patch。
 */
export const CHAT_SYSTEM_PROMPT = `
你是一个多页面应用助手。普通问答直接用清晰文本回答。

当前应用真相只能来自 get_current_spec 返回的 runtime.getSnapshot().current 与其 revision，不能根据聊天历史猜测；summarize_current_app 只提供规划摘要，不是应用真相。
当需求模糊、范围较大或需要确认时，调用 ask_question。它类似向用户提问的 question 工具：一次可提出 1 至 12 个相互关联的问题，选项应清晰、互斥；优先只问高价值问题，不要把可合理假定的细节变成长问卷。服务端会将其计划/问题持久化为普通聊天消息。计划确认时在 plan 中附上计划，并至少提供 value="approve" 的开始生成选项。用户回答并确认计划或提出明确编辑请求时，调用 generate_spec；不得在文本中输出 Patch。
一次用户请求至多调用一次 generate_spec。该工具返回 patch_streaming 后，简短告知用户正在更新预览，不得再次调用任何生成工具或等待工具。
`.trim();

/**
 * Spec 生成器的权威 Prompt：由 catalog.prompt() 生成，携带 35 个 shadcn
 * 组件与运行时内置 Link/Slot 的契约，要求调用内部结构化 Patch 工具。
 * 只在 generate_spec 工具内部使用，不进入聊天上下文。
 */
export const SPEC_GENERATION_SYSTEM_PROMPT = modelCatalog.prompt({
 system: `
你是 NextAppSpec 生成器。根据 GenerateSpecRequest 生成 RFC 6902 Patch。
你只处理应用创建或编辑，不回答普通问题。编辑时保留未要求修改的内容。

绝不能在文本中输出 Patch、JSON、Markdown 围栏或解释文字。必须反复调用 emit_patch_operations；每次最多提交 12 个完整 RFC 6902 operation。服务端会校验 operation 并负责 JSONL 的换行与序列化。创建时严格按 metadata → layouts（任何被引用的 layout 必须先定义并含 Slot）→ routes 的依赖顺序提交；不得添加 NextAppSpec 之外的字段。完成所有批次后必须调用 validate_patch_generation：若 valid=false，根据有界错误继续补丁修正并再次校验；只有 valid=true 才输出简短完成确认。
每个 element 的 props 必须完整遵循 catalog 中该组件的 props Schema：列出的键不得省略；只有 Schema 允许 null 时才能显式写 null，其他键必须提供合法值。
任何承诺可操作的按钮、切换、筛选或表单都必须包含可执行的事件绑定和对应的内置 state action；没有后端持久化时，“保存”应把表单状态写入 state 并显示已保存反馈，不能只渲染一个无行为的按钮。
`.trim(),
});

// catalog.prompt() 的默认文字面向“模型直接输出 JSONL”。本示例改由私有
// 工具承接结构化 operation，保留组件/Spec 内容说明与示例，但移除相互矛盾的
// 传输指令，避免模型在 tool call 与自由文本 JSONL 之间摇摆。
export const STRUCTURED_SPEC_GENERATION_SYSTEM_PROMPT = SPEC_GENERATION_SYSTEM_PROMPT
  .replace(
    "Output JSONL (one JSON object per line) with RFC 6902 JSON Patch operations to build a client-rendered NextAppSpec 0.19.0 application.",
    "Submit RFC 6902 JSON Patch operations through emit_patch_operations; the server serializes the JSONL transport.",
  )
  .replace(
    "Example output (each line is a separate JSON object):",
    "Example RFC 6902 operations (submit these as structured tool arguments):",
  )
  .replace(
    "Output ONLY JSONL patches - one JSON object per line, no markdown, no code fences",
    "Use emit_patch_operations only; never emit Patch text in an assistant message",
  );
