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

const arrayBufferIsView = ArrayBuffer.isView;
const reflectApply = Reflect.apply;
const reflectGet = Reflect.get;
const Uint8ArrayConstructor = Uint8Array;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)?.get;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteOffset",
)?.get;
const readableStreamGetReader = typeof ReadableStream === "function"
  ? ReadableStream.prototype.getReader
  : undefined;

function normalizeUint8Array(
  value: unknown,
): { byteLength: number; view: Uint8Array } | null {
  if (
    !arrayBufferIsView(value) ||
    !typedArrayTagGetter ||
    !typedArrayBufferGetter ||
    !typedArrayByteLengthGetter ||
    !typedArrayByteOffsetGetter
  ) return null;
  try {
    if (reflectApply(typedArrayTagGetter, value, []) !== "Uint8Array") return null;
    const buffer = reflectApply(typedArrayBufferGetter, value, []) as ArrayBufferLike;
    const byteLength = reflectApply(typedArrayByteLengthGetter, value, []) as number;
    const byteOffset = reflectApply(typedArrayByteOffsetGetter, value, []) as number;
    return {
      byteLength,
      view: new Uint8ArrayConstructor(buffer, byteOffset, byteLength),
    };
  } catch {
    return null;
  }
}

function getReadableStreamReader(
  input: unknown,
): ReadableStreamDefaultReader<string | Uint8Array> | null {
  if (!readableStreamGetReader) return null;
  try {
    return reflectApply(readableStreamGetReader, input, []) as
      ReadableStreamDefaultReader<string | Uint8Array>;
  } catch {
    return null;
  }
}

function decodeUtf8(operation: () => string): string {
  try {
    return operation();
  } catch {
    throw new RuntimeError("contract_invalid", "Source is not valid UTF-8");
  }
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
  const byteInput = normalizeUint8Array(input);
  if (byteInput) {
    if (byteInput.byteLength > maxBytes) {
      throw new RuntimeError("source_limit_exceeded", "Source exceeds maxBytes");
    }
    yield decodeUtf8(() => new TextDecoder("utf-8", { fatal: true }).decode(byteInput.view));
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
      countStringChunk(chunk);
      value = `${decodingBytes ? decodeUtf8(() => decoder.decode()) : ""}${chunk}`;
      decodingBytes = false;
    } else {
      const byteChunk = normalizeUint8Array(chunk);
      if (!byteChunk) {
        throw new RuntimeError(
          "contract_invalid",
          "Source chunks must be strings or Uint8Array values",
        );
      }
      flushPendingHighSurrogate();
      bytes += byteChunk.byteLength;
      assertWithinLimit();
      value = decodeUtf8(() => decoder.decode(byteChunk.view, { stream: true }));
      decodingBytes = true;
    }
    return value;
  };

  const reader = getReadableStreamReader(input);
  if (reader) {
    let cancelPromise: Promise<void> | null = null;
    const cancelOnce = (reason?: unknown) => {
      if (!cancelPromise) {
        try {
          cancelPromise = reader.cancel(reason).then(() => undefined, () => undefined);
        } catch {
          cancelPromise = Promise.resolve();
        }
      }
      return cancelPromise;
    };
    let complete = false;
    try {
      while (true) {
        const item = await waitFor(reader.read(), signal, () => {
          void cancelOnce(abortError());
        });
        assertNotAborted(signal);
        if (item.done) break;
        const value = decode(item.value);
        if (value) yield value;
      }
      complete = true;
    } finally {
      try {
        if (!complete) {
          const cancellation = cancelOnce(signal?.aborted ? abortError() : undefined);
          if (!signal?.aborted) {
            await waitFor(cancellation, signal, () => undefined);
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
  } else {
    let asyncIterator: unknown;
    try {
      asyncIterator = reflectGet(input as object, Symbol.asyncIterator);
    } catch {
      throw new RuntimeError(
        "contract_invalid",
        "Source must be a string, Uint8Array, ReadableStream, or AsyncIterable",
      );
    }
    if (typeof asyncIterator !== "function") {
      throw new RuntimeError(
        "contract_invalid",
        "Source must be a string, Uint8Array, ReadableStream, or AsyncIterable",
      );
    }
    let iterator: AsyncIterator<string | Uint8Array>;
    try {
      iterator = reflectApply(asyncIterator, input, []) as
        AsyncIterator<string | Uint8Array>;
    } catch {
      throw new RuntimeError(
        "contract_invalid",
        "Source must be a string, Uint8Array, ReadableStream, or AsyncIterable",
      );
    }
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
      if (!complete) {
        const close = closeOnce();
        if (!signal?.aborted) {
          await waitFor(close, signal, () => undefined);
        }
      }
    }
  }

  flushPendingHighSurrogate();
  if (decodingBytes) {
    const final = decodeUtf8(() => decoder.decode());
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
