import { RuntimeError, type SourceInput } from "../contract/types.js";
import { assertPositiveRuntimeLimit } from "../validation/limits.js";

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function waitFor<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => void,
): Promise<T> {
  if (!signal) return promise;
  assertNotAborted(signal);
  let rejectAbort!: (reason: DOMException) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const handleAbort = () => {
    onAbort();
    rejectAbort(abortError());
  };
  signal.addEventListener("abort", handleAbort, { once: true });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", handleAbort);
  }
}

export async function* readSourceChunks(
  input: SourceInput,
  maxBytes: number,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  assertPositiveRuntimeLimit("maxBytes", maxBytes);
  assertNotAborted(signal);
  if (typeof input === "string") {
    if (byteLength(input) > maxBytes) {
      throw new RuntimeError("source_limit_exceeded", "Source exceeds maxBytes");
    }
    yield input;
    return;
  }
  if (input instanceof Uint8Array) {
    if (input.byteLength > maxBytes) {
      throw new RuntimeError("source_limit_exceeded", "Source exceeds maxBytes");
    }
    yield new TextDecoder("utf-8", { fatal: true }).decode(input);
    return;
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let decodingBytes = false;
  let pendingHighSurrogate = "";
  const assertWithinLimit = () => {
    if (bytes > maxBytes) {
      throw new RuntimeError("source_limit_exceeded", "Source exceeds maxBytes");
    }
  };
  const flushPendingHighSurrogate = () => {
    if (!pendingHighSurrogate) return;
    bytes += byteLength(pendingHighSurrogate);
    pendingHighSurrogate = "";
    assertWithinLimit();
  };
  const countStringChunk = (chunk: string) => {
    let value = pendingHighSurrogate + chunk;
    pendingHighSurrogate = "";
    const finalCodeUnit = value.charCodeAt(value.length - 1);
    if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
      pendingHighSurrogate = value.slice(-1);
      value = value.slice(0, -1);
    }
    bytes += byteLength(value);
    assertWithinLimit();
  };
  const decode = (chunk: string | Uint8Array): string => {
    let value: string;
    if (typeof chunk === "string") {
      value = `${decodingBytes ? decoder.decode() : ""}${chunk}`;
      decodingBytes = false;
      countStringChunk(chunk);
    } else {
      flushPendingHighSurrogate();
      value = decoder.decode(chunk, { stream: true });
      decodingBytes = true;
      bytes += chunk.byteLength;
      assertWithinLimit();
    }
    return value;
  };

  if ("getReader" in input) {
    const reader = input.getReader();
    let complete = false;
    try {
      while (true) {
        const item = await waitFor(reader.read(), signal, () => {
          void reader.cancel(abortError()).catch(() => undefined);
        });
        assertNotAborted(signal);
        if (item.done) break;
        const value = decode(item.value);
        if (value) yield value;
      }
      complete = true;
    } finally {
      if (!complete) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } else {
    const iterator = input[Symbol.asyncIterator]();
    let closePromise: Promise<void> | null = null;
    const closeOnce = () => {
      closePromise ??= Promise.resolve()
        .then(() => iterator.return?.())
        .then(() => undefined, () => undefined);
      return closePromise;
    };
    let complete = false;
    try {
      while (true) {
        const item = await waitFor(iterator.next(), signal, () => {
          void closeOnce();
        });
        assertNotAborted(signal);
        if (item.done) break;
        const value = decode(item.value);
        if (value) yield value;
      }
      complete = true;
    } finally {
      if (!complete) await closeOnce();
    }
  }

  flushPendingHighSurrogate();
  if (decodingBytes) {
    const final = decoder.decode();
    if (final) yield final;
  }
}

export async function readSource(
  input: SourceInput,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  let result = "";
  for await (const chunk of readSourceChunks(input, maxBytes, signal)) {
    result += chunk;
  }
  return result;
}
