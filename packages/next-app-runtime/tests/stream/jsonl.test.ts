import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";

import { RuntimeError } from "../../src/contract/types.js";
import { compileJsonlPatch } from "../../src/stream/jsonl-compiler.js";
import { readSource } from "../../src/stream/source.js";

async function* chunks(values: Array<string | Uint8Array>) {
  for (const value of values) yield value;
}

describe("JSONL source compiler", () => {
  it("decodes split UTF-8 chunks and a final line without newline", async () => {
    const encoded = new TextEncoder().encode(
      '{"op":"add","path":"/message","value":"你好"}',
    );
    const result = await compileJsonlPatch(
      {},
      chunks([encoded.slice(0, encoded.length - 1), encoded.slice(encoded.length - 1)]),
      { maxBytes: 1_000, maxOperations: 10 },
    );
    expect(result).toEqual({ value: { message: "你好" }, operations: 1 });
  });

  it("counts a surrogate pair consistently across string chunk boundaries", async () => {
    await expect(readSource("😀", 4)).resolves.toBe("😀");
    await expect(readSource(chunks(["\ud83d", "\ude00"]), 4)).resolves.toBe("😀");
    await expect(readSource(chunks(["\ud83d", "\ude00"]), 3)).rejects.toMatchObject({
      code: "source_limit_exceeded",
    });
  });

  it("keeps byte accounting stable across string, byte, and EOF boundaries", async () => {
    const emoji = new TextEncoder().encode("😀");

    await expect(readSource(chunks(["x", emoji]), 5)).resolves.toBe("x😀");
    await expect(readSource(chunks([emoji, "x"]), 5)).resolves.toBe("😀x");
    await expect(readSource(chunks(["\ud83d", new Uint8Array([0x78])]), 4))
      .resolves.toBe("\ud83dx");
    await expect(readSource(chunks(["\ud83d"]), 3)).resolves.toBe("\ud83d");
    await expect(readSource(chunks(["\ud83d"]), 2)).rejects.toMatchObject({
      code: "source_limit_exceeded",
    });
  });

  it("accepts a cross-realm Uint8Array as a byte source", async () => {
    const source = runInNewContext(
      "new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f])",
    ) as Uint8Array;

    expect(source).not.toBeInstanceOf(Uint8Array);
    await expect(readSource(source, 5)).resolves.toBe("hello");
  });

  it("rejects non-Uint8 views that spoof the Uint8Array tag", async () => {
    const values: Array<DataView | Uint16Array> = [
      new DataView(new ArrayBuffer(2)),
      new Uint16Array(1),
    ];
    for (const value of values) {
      Object.defineProperty(value, Symbol.toStringTag, {
        configurable: true,
        value: "Uint8Array",
      });
      await expect(readSource(
        value as unknown as Uint8Array,
        10,
      )).rejects.toMatchObject({ code: "contract_invalid" });
      await expect(readSource(
        chunks([value as unknown as Uint8Array]),
        10,
      )).rejects.toMatchObject({ code: "contract_invalid" });
    }
  });

  it("uses intrinsic Uint8Array bounds when instance properties are shadowed", async () => {
    const shadowed = new Uint8Array([0x61, 0x62, 0x63, 0x64]);
    Object.defineProperties(shadowed, {
      buffer: { configurable: true, value: new ArrayBuffer(0) },
      byteLength: { configurable: true, value: 0 },
      byteOffset: { configurable: true, value: 0 },
    });

    await expect(readSource(shadowed, 3)).rejects.toMatchObject({
      code: "source_limit_exceeded",
    });
    await expect(readSource(shadowed, 4)).resolves.toBe("abcd");
    await expect(readSource(chunks([shadowed]), 3)).rejects.toMatchObject({
      code: "source_limit_exceeded",
    });
    await expect(readSource(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(shadowed);
        controller.close();
      },
    }), 3)).rejects.toMatchObject({ code: "source_limit_exceeded" });
  });

  it("uses an AsyncIterator when an AsyncIterable has getReader set to undefined", async () => {
    const source: AsyncIterable<string> & { getReader: undefined } = {
      getReader: undefined,
      async *[Symbol.asyncIterator]() {
        yield "hello";
      },
    };

    await expect(readSource(source, 5)).resolves.toBe("hello");
  });

  it("does not inspect an unrelated throwing getReader getter on an AsyncIterable", async () => {
    const source = {
      get getReader(): never {
        throw new Error("sensitive getReader failure");
      },
      async *[Symbol.asyncIterator]() {
        yield "hello";
      },
    };

    await expect(readSource(source, 5)).resolves.toBe("hello");

    const methodSource = {
      getReader(): never {
        throw new Error("sensitive getReader method failure");
      },
      async *[Symbol.asyncIterator]() {
        yield "hello";
      },
    };
    await expect(readSource(methodSource, 5)).resolves.toBe("hello");

    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("hello");
        controller.close();
      },
    });
    Object.defineProperty(stream, "getReader", {
      configurable: true,
      value() {
        throw new Error("sensitive shadowed stream method failure");
      },
    });
    await expect(readSource(stream, 5)).resolves.toBe("hello");
  });

  it("normalizes and redacts AsyncIterator and ReadableStream provider failures", async () => {
    let iteratorGetterCalls = 0;
    let doneGetterCalls = 0;
    let valueGetterCalls = 0;
    const iteratorGetter = Object.defineProperty({}, Symbol.asyncIterator, {
      get() {
        iteratorGetterCalls += 1;
        throw new Error("sensitive iterator getter failure");
      },
    });
    const malformedDone = Object.defineProperty({}, "done", {
      enumerable: true,
      get() {
        doneGetterCalls += 1;
        throw new Error("sensitive done getter failure");
      },
    });
    const malformedValue = Object.defineProperties({}, {
      done: { enumerable: true, value: false },
      value: {
        enumerable: true,
        get() {
          valueGetterCalls += 1;
          throw new Error("sensitive value getter failure");
        },
      },
    });
    const iterable = (next: () => unknown) => ({
      [Symbol.asyncIterator]() {
        return { next };
      },
    });
    const sources: Array<{ source: unknown; message: string }> = [
      {
        source: iteratorGetter,
        message: "Source must be a string, Uint8Array, ReadableStream, or AsyncIterable",
      },
      {
        source: {
          [Symbol.asyncIterator]() {
            throw new Error("sensitive iterator factory failure");
          },
        },
        message: "Source must be a string, Uint8Array, ReadableStream, or AsyncIterable",
      },
      {
        source: iterable(() => { throw new Error("sensitive sync iterator failure"); }),
        message: "Source provider failed",
      },
      {
        source: iterable(() => Promise.reject(new Error("sensitive async iterator failure"))),
        message: "Source provider failed",
      },
      { source: iterable(() => null), message: "Source provider returned an invalid result" },
      { source: iterable(() => 1), message: "Source provider returned an invalid result" },
      { source: iterable(() => malformedDone), message: "Source provider returned an invalid result" },
      { source: iterable(() => malformedValue), message: "Source provider returned an invalid result" },
      {
        source: new ReadableStream<string>({
          pull() {
            throw new Error("sensitive readable failure");
          },
        }),
        message: "Source provider failed",
      },
    ];

    for (const { source, message } of sources) {
      let failure: unknown;
      try {
        await readSource(source as AsyncIterable<string>, 100);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(RuntimeError);
      expect(failure).toMatchObject({ code: "contract_invalid", message });
      expect(String(failure)).not.toContain("sensitive");
      expect(String(failure)).not.toContain("Cannot read properties");
      expect(JSON.stringify(failure)).not.toContain("sensitive");
      expect(JSON.stringify(failure)).not.toContain("Cannot read properties");
    }
    expect(iteratorGetterCalls).toBe(1);
    expect(doneGetterCalls).toBe(0);
    expect(valueGetterCalls).toBe(0);
  });

  it("accepts the standard IteratorResult form with an omitted false done field", async () => {
    let index = 0;
    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator](): AsyncIterator<string> {
        return {
          next() {
            index += 1;
            return index === 1
              ? Promise.resolve({ value: "ok" })
              : Promise.resolve({ done: true as const, value: undefined });
          },
        };
      },
    };
    await expect(readSource(source, 100)).resolves.toBe("ok");
  });

  it("consumes cleanup rejection after an AsyncIterator provider failure", async () => {
    const providerFailure = new Error("provider secret");
    const cleanupFailure = new Error("cleanup secret");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(readSource({
        [Symbol.asyncIterator]() {
          return {
            next: () => Promise.reject(providerFailure),
            return: () => Promise.reject(cleanupFailure),
          };
        },
      }, 100)).rejects.toMatchObject({
        code: "contract_invalid",
        message: "Source provider failed",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });

  it("normalizes fatal UTF-8 decoding failures", async () => {
    const sources = [
      new Uint8Array([0xff]),
      chunks([new Uint8Array([0xc3]), new Uint8Array([0x28])]),
      chunks([new Uint8Array([0xc3])]),
    ];

    for (const source of sources) {
      let failure: unknown;
      try {
        await readSource(source, 10);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(RuntimeError);
      expect(failure).toMatchObject({
        code: "contract_invalid",
        message: "Source is not valid UTF-8",
      });
      expect(JSON.stringify(failure)).not.toContain("0xff");
      expect(JSON.stringify(failure)).not.toContain("0xc3");
    }
  });

  it("checks streamed byte limits before decoding invalid UTF-8", async () => {
    await expect(readSource(
      chunks([new Uint8Array([0xff, 0xff])]),
      1,
    )).rejects.toMatchObject({
      code: "source_limit_exceeded",
    });
  });

  it("checks mixed byte and string limits before flushing invalid UTF-8", async () => {
    const source = () => chunks([new Uint8Array([0xc3]), "ab"]);

    await expect(readSource(source(), 1)).rejects.toMatchObject({
      code: "source_limit_exceeded",
    });
    await expect(readSource(source(), 2)).rejects.toMatchObject({
      code: "source_limit_exceeded",
    });
    await expect(readSource(source(), 3)).rejects.toMatchObject({
      code: "contract_invalid",
    });
  });

  it("produces the same reserved-key NextAppSpec graph as a direct JSON source", async () => {
    const direct = JSON.parse(`{
      "routes": {},
      "state": {
        "__proto__": { "enabled": true },
        "constructor": { "prototype": { "enabled": true } },
        "prototype": { "enabled": true }
      }
    }`) as Record<string, unknown>;
    const compiled = await compileJsonlPatch(
      {},
      [
        '{"op":"add","path":"/routes","value":{}}',
        '{"op":"add","path":"/state","value":{}}',
        '{"op":"add","path":"/state/__proto__","value":{"enabled":true}}',
        '{"op":"add","path":"/state/constructor","value":{"prototype":{"enabled":true}}}',
        '{"op":"add","path":"/state/prototype","value":{"enabled":true}}',
      ].join("\n"),
      { maxBytes: 1_000, maxOperations: 10 },
    );

    expect(JSON.stringify(compiled.value)).toBe(JSON.stringify(direct));
    const state = (compiled.value as { state: Record<string, unknown> }).state;
    expect(Object.hasOwn(state, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(compiled.value)).toBeNull();
    expect(Object.getPrototypeOf(state)).toBeNull();
    expect(({} as { enabled?: boolean }).enabled).toBeUndefined();
  });

  it("normalizes negative zero before publishing each operation candidate", async () => {
    const candidates: unknown[] = [];
    const result = await compileJsonlPatch(
      {},
      '{"op":"add","path":"/value","value":-0}\n' +
        '{"op":"replace","path":"/value","value":-0}',
      { maxBytes: 1_000, maxOperations: 10 },
      undefined,
      (candidate) => candidates.push(candidate),
    );

    for (const candidate of candidates as Array<{ value: number }>) {
      expect(candidate.value).toBe(0);
      expect(Object.is(candidate.value, -0)).toBe(false);
      expect(Object.getPrototypeOf(candidate)).toBeNull();
    }
    const value = (result.value as { value: number }).value;
    expect(value).toBe(0);
    expect(Object.is(value, -0)).toBe(false);
  });

  it("publishes every operation candidate", async () => {
    const candidates: unknown[] = [];
    await compileJsonlPatch(
      {},
      '{"op":"add","path":"/list","value":[]}\n' +
        '{"op":"add","path":"/list/-","value":1}\n' +
        '{"op":"add","path":"/list/-","value":1}',
      { maxBytes: 1_000, maxOperations: 10 },
      undefined,
      (candidate) => candidates.push(structuredClone(candidate)),
    );
    expect(candidates).toEqual([{ list: [] }, { list: [1] }, { list: [1, 1] }]);
  });

  it("does not let an operation observer mutate the live transaction candidate", async () => {
    const candidates: unknown[] = [];
    const result = await compileJsonlPatch(
      {},
      '{"op":"add","path":"/list","value":[]}' +
        '\n{"op":"add","path":"/list/-","value":1}',
      { maxBytes: 1_000, maxOperations: 10 },
      undefined,
      (candidate) => {
        candidates.push(structuredClone(candidate));
        Object.assign(candidate as object, { injected: true });
      },
    );

    expect(candidates).toEqual([{ list: [] }, { list: [1] }]);
    expect(result).toEqual({ value: { list: [1] }, operations: 2 });
  });

  it("does not let an operation observer exception abort the patch transaction", async () => {
    const result = await compileJsonlPatch(
      {},
      '{"op":"add","path":"/list","value":[]}' +
        '\n{"op":"add","path":"/list/-","value":1}',
      { maxBytes: 1_000, maxOperations: 10 },
      undefined,
      () => {
        throw new Error("observer failed");
      },
    );

    expect(result).toEqual({ value: { list: [1] }, operations: 2 });
  });

  it("handles an async operation observer rejection without awaiting it", async () => {
    const observerFailure = new Error("async observer failed");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      if (reason === observerFailure) unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const result = await compileJsonlPatch(
        {},
        '{"op":"add","path":"/ready","value":true}',
        { maxBytes: 1_000, maxOperations: 10 },
        undefined,
        async () => {
          throw observerFailure;
        },
      );

      expect(result).toEqual({ value: { ready: true }, operations: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });

  it("handles a rejected operation observer thenable without awaiting it", async () => {
    let thenGetterCalls = 0;
    let thenCalls = 0;
    const thenable = Object.defineProperty({}, "then", {
      get() {
        thenGetterCalls += 1;
        return (_resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
          thenCalls += 1;
          reject(new Error("thenable observer failed"));
        };
      },
    });
    const result = await compileJsonlPatch(
      {},
      '{"op":"add","path":"/ready","value":true}',
      { maxBytes: 1_000, maxOperations: 10 },
      undefined,
      () => thenable,
    );

    expect(result).toEqual({ value: { ready: true }, operations: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(thenGetterCalls).toBe(1);
    expect(thenCalls).toBe(1);
  });

  it("rejects a non-JSON base before cloning it", async () => {
    let getterCalls = 0;
    const base = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "not-safe";
      },
    });

    await expect(compileJsonlPatch(
      base,
      "",
      { maxBytes: 1_000, maxOperations: 10 },
    )).rejects.toMatchObject({ code: "patch_invalid" });
    expect(getterCalls).toBe(0);

    await expect(compileJsonlPatch(
      new Date(0),
      "",
      { maxBytes: 1_000, maxOperations: 10 },
    )).rejects.toMatchObject({ code: "patch_invalid" });
  });

  it("publishes a complete JSONL operation before the source closes", async () => {
    let streamController!: ReadableStreamDefaultController<string>;
    const source = new ReadableStream<string>({
      start(controller) {
        streamController = controller;
      },
    });
    const candidates: unknown[] = [];
    const result = compileJsonlPatch(
      {},
      source,
      { maxBytes: 1_000, maxOperations: 10 },
      undefined,
      (candidate) => candidates.push(structuredClone(candidate)),
    );

    streamController.enqueue('{"op":"add","path":"/routes","value":{}}\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const beforeClose = structuredClone(candidates);
    streamController.close();
    await result;

    expect(beforeClose).toEqual([{ routes: {} }]);
  });

  it("enforces byte and operation limits", async () => {
    await expect(readSource("1234", 3)).rejects.toMatchObject({ code: "source_limit_exceeded" });
    await expect(compileJsonlPatch(
      {},
      '{"op":"add","path":"/a","value":1}\n{"op":"add","path":"/b","value":2}',
      { maxBytes: 1_000, maxOperations: 1 },
    )).rejects.toBeInstanceOf(RuntimeError);
  });

  it("rejects an oversized intermediate document before publishing a candidate", async () => {
    const base = { state: { seed: "x".repeat(200) } };
    const input = [
      '{"op":"copy","from":"/state/seed","path":"/state/copy"}',
      '{"op":"remove","path":"/state/copy"}',
    ].join("\n");
    const maxBytes = new TextEncoder().encode(JSON.stringify(base)).byteLength;
    expect(new TextEncoder().encode(input).byteLength).toBeLessThan(maxBytes);
    expect(new TextEncoder().encode(JSON.stringify({
      state: { seed: base.state.seed, copy: base.state.seed },
    })).byteLength).toBeGreaterThan(maxBytes);
    const candidates: unknown[] = [];

    await expect(compileJsonlPatch(
      base,
      input,
      { maxBytes, maxOperations: 10 },
      undefined,
      (candidate) => candidates.push(candidate),
    )).rejects.toMatchObject({ code: "source_limit_exceeded" });
    expect(candidates).toEqual([]);
  });

  it("rejects non-finite and non-positive limits", async () => {
    await expect(compileJsonlPatch(
      {},
      "",
      { maxBytes: 10, maxOperations: Number.NaN },
    )).rejects.toMatchObject({ code: "source_limit_exceeded" });
    await expect(compileJsonlPatch(
      {},
      "",
      { maxBytes: Number.POSITIVE_INFINITY, maxOperations: 10 },
    )).rejects.toMatchObject({ code: "source_limit_exceeded" });
  });

  it("honors an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(compileJsonlPatch(
      {},
      chunks(["{\"op\":\"add\",\"path\":\"/x\",\"value\":1}"]),
      { maxBytes: 1_000, maxOperations: 10 },
      controller.signal,
    )).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels a pending ReadableStream read when aborted", async () => {
    let streamController!: ReadableStreamDefaultController<string>;
    let cancelCalls = 0;
    const source = new ReadableStream<string>({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        cancelCalls += 1;
      },
    });
    const controller = new AbortController();
    const pending = readSource(source, 1_000, controller.signal).then(
      () => "resolved",
      (error: unknown) => error instanceof DOMException ? error.name : "rejected",
    );

    controller.abort();
    const outcome = await Promise.race([
      pending,
      new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 25)),
    ]);
    if (outcome === "timed-out") {
      streamController.close();
      await pending;
    }

    expect(outcome).toBe("AbortError");
    expect(cancelCalls).toBe(1);
  });

  it("interrupts a pending ReadableStream cleanup when aborted after a decode failure", async () => {
    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    let notifyCancel!: () => void;
    const cancelStarted = new Promise<void>((resolve) => {
      notifyCancel = resolve;
    });
    let cancelCalls = 0;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff]));
      },
      cancel() {
        cancelCalls += 1;
        notifyCancel();
        return cancelGate;
      },
    });
    const controller = new AbortController();
    const pending = readSource(source, 1_000, controller.signal).then(
      () => "resolved",
      (error: unknown) => error instanceof DOMException ? error.name : "rejected",
    );

    await cancelStarted;
    controller.abort();
    const outcome = await Promise.race([
      pending,
      new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 25)),
    ]);
    releaseCancel();
    await pending;

    expect(outcome).toBe("AbortError");
    expect(cancelCalls).toBe(1);
  });

  it("closes an aborted AsyncIterator exactly once", async () => {
    let returnCalls = 0;
    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<string>>(() => undefined),
          return: async () => {
            returnCalls += 1;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const controller = new AbortController();
    const pending = readSource(source, 1_000, controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(returnCalls).toBe(1);
  });

  it("does not wait for a pending AsyncIterator return after abort", async () => {
    let releaseReturn!: (result: IteratorResult<string>) => void;
    const returnGate = new Promise<IteratorResult<string>>((resolve) => {
      releaseReturn = resolve;
    });
    let returnCalls = 0;
    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<string>>(() => undefined),
          return: () => {
            returnCalls += 1;
            return returnGate;
          },
        };
      },
    };
    const controller = new AbortController();
    const pending = readSource(source, 1_000, controller.signal).then(
      () => "resolved",
      (error: unknown) => error instanceof DOMException ? error.name : "rejected",
    );

    controller.abort();
    const outcome = await Promise.race([
      pending,
      new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 25)),
    ]);
    releaseReturn({ done: true, value: undefined });
    await pending;

    expect(outcome).toBe("AbortError");
    expect(returnCalls).toBe(1);
  });

  it("interrupts a pending AsyncIterator cleanup when aborted after a decode failure", async () => {
    let releaseReturn!: (result: IteratorResult<Uint8Array>) => void;
    const returnGate = new Promise<IteratorResult<Uint8Array>>((resolve) => {
      releaseReturn = resolve;
    });
    let notifyReturn!: () => void;
    const returnStarted = new Promise<void>((resolve) => {
      notifyReturn = resolve;
    });
    let returnCalls = 0;
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => ({ done: false, value: new Uint8Array([0xff]) }),
          return: () => {
            returnCalls += 1;
            notifyReturn();
            return returnGate;
          },
        };
      },
    };
    const controller = new AbortController();
    const pending = readSource(source, 1_000, controller.signal).then(
      () => "resolved",
      (error: unknown) => error instanceof DOMException ? error.name : "rejected",
    );

    await returnStarted;
    controller.abort();
    const outcome = await Promise.race([
      pending,
      new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 25)),
    ]);
    releaseReturn({ done: true, value: undefined });
    await pending;

    expect(outcome).toBe("AbortError");
    expect(returnCalls).toBe(1);
  });
});
