import { RuntimeError, type SourceInput } from "../contract/types.js";
import { assertPositiveRuntimeLimit } from "../validation/limits.js";
import { applyJsonPatch, isJsonPatchOperation, type JsonPatchOperation } from "./json-patch.js";
import { readSourceChunks } from "./source.js";

function handleObserverRejection(value: unknown): void {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) return;
  try {
    void Promise.resolve(value).catch(() => undefined);
  } catch {
    // Observer results are best-effort and cannot affect the patch transaction.
  }
}

export async function compileJsonlPatch(
  base: unknown,
  input: SourceInput,
  limits: { maxBytes: number; maxOperations: number },
  signal?: AbortSignal,
  onOperation?: (candidate: unknown, operation: JsonPatchOperation, index: number) => void,
): Promise<{ value: unknown; operations: number }> {
  assertPositiveRuntimeLimit("maxBytes", limits.maxBytes);
  assertPositiveRuntimeLimit("maxOperations", limits.maxOperations);
  let value = applyJsonPatch(base, []);
  let operations = 0;
  let buffer = "";

  const applyLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.trim().length === 0) return;
    if (operations >= limits.maxOperations) {
      throw new RuntimeError("source_limit_exceeded", "Patch exceeds maxOperations");
    }
    let operation: unknown;
    try {
      operation = JSON.parse(line);
    } catch {
      throw new RuntimeError("patch_invalid", "JSONL line is not valid JSON");
    }
    if (!isJsonPatchOperation(operation)) {
      throw new RuntimeError("patch_invalid", "JSONL line is not an RFC 6902 operation");
    }
    value = applyJsonPatch(value, [operation]);
    try {
      const observerResult: unknown = onOperation?.(
        structuredClone(value),
        operation,
        operations,
      );
      handleObserverRejection(observerResult);
    } catch {
      // Observers receive best-effort snapshots and cannot affect the patch transaction.
    }
    operations += 1;
  };

  for await (const chunk of readSourceChunks(input, limits.maxBytes, signal)) {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      applyLine(line);
    }
  }
  if (buffer.length > 0) applyLine(buffer);
  return { value, operations };
}
