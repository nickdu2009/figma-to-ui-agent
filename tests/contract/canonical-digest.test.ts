/**
 * canonical JSON 与 digest 契约测试（S1，设计 §10.1）：
 * - v1 摘要语义与 release/service.ts 的 canonicalBusinessSchema 完全一致；
 * - 数组保持顺序、对象键按 UTF-16 字典序递归排序；
 * - candidateDigest 覆盖完整 Candidate（UI/BusinessSchema/迁移任一变化都改变）；
 * - uiBundleDigest 只随 UI Bundle 变化；浏览器异步与服务端同步摘要一致。
 */
import { describe, expect, it } from "vitest";

import {
  candidateDigest,
  digestCanonicalJsonSync,
  reportDigest,
  requestHash,
  sha256Hex,
  uiBundleDigest,
} from "../../server/bundle/digests.js";
import { canonicalBusinessSchema } from "../../server/release/service.js";
import {
  canonicalize,
  canonicalJsonByteLength,
  canonicalJsonString,
  digestCanonicalJson,
  isSha256Digest,
} from "../../src/catalog/canonical-json.js";

describe("canonical JSON serializer", () => {
  it("对象键按 UTF-16 字典序递归排序，数组保持顺序", () => {
    expect(canonicalJsonString({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJsonString({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
    expect(canonicalJsonString(null)).toBe("null");
    expect(canonicalJsonString(undefined)).toBe("null");
  });

  it("与 canonicalBusinessSchema 的 v1 序列化语义一致", () => {
    const value = {
      collections: [{ name: "items", fields: [{ key: "b" }, { key: "a" }] }],
      permissions: { z: 1, a: 2 },
    };
    expect(canonicalJsonString(value)).toBe(canonicalBusinessSchema(value));
    expect(canonicalJsonString(null)).toBe(canonicalBusinessSchema(null));
    expect(canonicalJsonString(undefined)).toBe(canonicalBusinessSchema(undefined));
  });

  it("canonicalize 返回键排序的深拷贝，不改原对象", () => {
    const input = { b: 1, a: 2 };
    const out = canonicalize(input) as Record<string, number>;
    expect(Object.keys(out)).toEqual(["a", "b"]);
    expect(Object.keys(input)).toEqual(["b", "a"]);
  });

  it("canonicalJsonByteLength 为 UTF-8 字节数", () => {
    expect(canonicalJsonByteLength({ a: "中" })).toBe(new TextEncoder().encode('{"a":"中"}').byteLength);
  });
});

describe("digest 稳定语义", () => {
  it("输出 sha256:<64 位小写十六进制>", () => {
    const digest = digestCanonicalJsonSync({ a: 1 });
    expect(isSha256Digest(digest)).toBe(true);
    expect(digest).toBe(`sha256:${sha256Hex('{"a":1}')}`);
  });

  it("确定性：键序无关、值变则变", () => {
    const a = { x: 1, y: [2, 3], z: { b: 1, a: 2 } };
    const b = { z: { a: 2, b: 1 }, y: [2, 3], x: 1 };
    expect(candidateDigest(a)).toBe(candidateDigest(b));
    expect(candidateDigest(a)).not.toBe(candidateDigest({ ...a, x: 2 }));
  });

  it("浏览器异步与服务端同步摘要一致（共享 uiBundleDigest serializer）", async () => {
    const shared = { bundle: true, list: [1, 2], nested: { z: 0, a: "中" } };
    expect(await digestCanonicalJson(shared)).toBe(uiBundleDigest(shared));
  });

  it("candidateDigest 覆盖完整 Candidate：UI/业务/迁移任一变化都改变", () => {
    const baseCandidate = {
      uiBundle: { bundleVersion: 1, spec: { routes: {} } },
      businessSchema: null,
      migrationEdge: {
        fromPublishedVersionId: null,
        fromSchemaDigest: `sha256:${"0".repeat(64)}`,
        toSchemaDigest: `sha256:${"1".repeat(64)}`,
      },
    };
    const baseDigest = candidateDigest(baseCandidate);
    const uiChanged = structuredClone(baseCandidate);
    (uiChanged.uiBundle as { spec: { routes: Record<string, unknown> } }).spec.routes["/"] = {};
    expect(candidateDigest(uiChanged)).not.toBe(baseDigest);
    const schemaChanged = { ...baseCandidate, businessSchema: { collections: [{ name: "c" }] } };
    expect(candidateDigest(schemaChanged)).not.toBe(baseDigest);
    const edgeChanged = structuredClone(baseCandidate);
    (edgeChanged.migrationEdge as { fromPublishedVersionId: string | null }).fromPublishedVersionId = "pv-1";
    expect(candidateDigest(edgeChanged)).not.toBe(baseDigest);
  });

  it("uiBundleDigest 只随 UI Bundle 变化", () => {
    const bundle = { bundleVersion: 1, spec: { routes: {} } };
    expect(uiBundleDigest(bundle)).toBe(uiBundleDigest({ spec: { routes: {} }, bundleVersion: 1 }));
    expect(uiBundleDigest(bundle)).not.toBe(uiBundleDigest({ bundleVersion: 1, spec: { routes: { "/": {} } } }));
  });

  it("requestHash 与 reportDigest 使用同一 canonical helper", () => {
    const params = { b: 2, a: 1 };
    expect(requestHash(params)).toBe(digestCanonicalJsonSync(params));
    expect(reportDigest({ issues: [] })).toBe(digestCanonicalJsonSync({ issues: [] }));
  });
});
