/**
 * 受控 CSV 导出（设计 §9.2，计划 S8 动作 8）。
 *
 * - 公式注入中和（唯一规则，先于 RFC 4180 quote/escape）：若原值以
 *   HT/CR/LF 开头，或跳过任意 Unicode whitespace/control 前缀后的首个可见
 *   code point 是 `= + - @`，就在**未删改的原值最前面**增加一个 ASCII
 *   apostrophe (')；否则保持原值。不 trim、不删除、不重排用户数据；
 *   因此 "-123" 之类的文本也按安全规则导出为文本。
 * - RFC 4180：双引号成对转义；含逗号/双引号/CR/LF 的字段整体加引号；
 *   行尾 CRLF。
 * - 上限：10,000 条记录；10 MiB 按中和并完成 RFC 4180 编码后的完整 UTF-8
 *   正文计算。任一上限命中即在发送正文前返回 413/export_too_large，
 *   不返回部分文件。
 * - Blob/字节不进入 Runtime state、Bundle、ActionResult、模型或日志。
 */
import { BusinessActionError } from "./contracts.ts";

export const CSV_MAX_RECORDS = 10_000;
export const CSV_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB（编码后完整 UTF-8 正文）

const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@"]);

/** 是否 Unicode whitespace 或控制字符（Cc/Cf）。 */
function isSkippablePrefix(cp: string): boolean {
  return /\s/u.test(cp) || /[\p{Cc}\p{Cf}]/u.test(cp);
}

/**
 * 公式中和判定：原值以 HT/CR/LF 开头，或跳过 whitespace/control 前缀后
 * 首个可见 code point ∈ {=, +, -, @}。
 */
export function needsFormulaNeutralization(raw: string): boolean {
  if (raw.length === 0) return false;
  const first = raw.charAt(0);
  if (first === "\t" || first === "\r" || first === "\n") return true;
  for (const char of raw) {
    if (isSkippablePrefix(char)) continue;
    return FORMULA_TRIGGER_CHARS.has(char);
  }
  // 全是空白/控制字符：无可见触发字符
  return false;
}

/** 中和：在未删改的原值最前面加 ASCII apostrophe；否则原样返回。 */
export function neutralizeFormula(raw: string): string {
  return needsFormulaNeutralization(raw) ? `'${raw}` : raw;
}

/** RFC 4180 字段编码（在中和后的值上执行）。 */
export function encodeCsvField(neutralized: string): string {
  if (/[",\r\n]/.test(neutralized)) {
    return `"${neutralized.replaceAll('"', '""')}"`;
  }
  return neutralized;
}

/** 单元格完整编码：中和 → RFC 4180。 */
export function encodeCsvCell(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  let text: string;
  if (typeof raw === "string") {
    text = raw;
  } else if (raw instanceof Date) {
    text = raw.toISOString();
  } else if (typeof raw === "object") {
    text = JSON.stringify(raw);
  } else {
    text = String(raw as string | number | boolean);
  }
  return encodeCsvField(neutralizeFormula(text));
}

export interface CsvExportInput {
  /** 列头（字段 key 顺序固定，来自 Schema 授权投影）。 */
  headers: string[];
  /** 每行与 headers 等长的原始值。 */
  rows: unknown[][];
  /** 已应用导出上限前的总记录数（调用方提供，用于 413 判定）。 */
  totalRows: number;
}

export interface CsvExportResult {
  body: string;
  byteLength: number;
  rowCount: number;
}

/** 编码完整 CSV 正文；任一上限命中抛 export_too_large（发送正文前）。 */
export function encodeCsv(input: CsvExportInput): CsvExportResult {
  if (input.totalRows > CSV_MAX_RECORDS) {
    throw new BusinessActionError(
      413,
      "export_too_large",
      `导出记录数超限：${input.totalRows} > ${CSV_MAX_RECORDS}`,
    );
  }
  const lines: string[] = [];
  lines.push(input.headers.map((header) => encodeCsvCell(header)).join(","));
  for (const row of input.rows) {
    lines.push(row.map((cell) => encodeCsvCell(cell)).join(","));
  }
  const body = `${lines.join("\r\n")}\r\n`;
  const byteLength = Buffer.byteLength(body, "utf8");
  if (byteLength > CSV_MAX_BYTES) {
    throw new BusinessActionError(
      413,
      "export_too_large",
      `导出正文超限：${byteLength} > ${CSV_MAX_BYTES}`,
    );
  }
  return { body, byteLength, rowCount: input.rows.length };
}

/** 安全规范化导出文件名（Content-Disposition 用；不含路径/控制字符）。 */
export function safeExportFileName(collectionKey: string, now: Date): string {
  const base = collectionKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || "export";
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${base}-${stamp}.csv`;
}
