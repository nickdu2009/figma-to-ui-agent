import { describe, expect, it } from "vitest";

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
});
