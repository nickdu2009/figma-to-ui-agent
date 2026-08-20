/**
 * 服务端摘要（设计 §10.1）：
 * - specDigest / uiBundleDigest / candidateDigest / reportDigest 均基于共享 canonical JSON helper；
 * - 完整 Candidate serializer 为 server-only（浏览器只核对 uiBundleDigest）；
 * - v1 输出 `sha256:` + 64 位小写十六进制；digestVersion 恒为 1。
 */
import { createHash } from "node:crypto";

import {
 canonicalJsonString,
 type Sha256Digest,
} from "../../src/catalog/canonical-json.ts";

export const DIGEST_VERSION = 1 as const;

export function sha256Hex(input: string): string {
 return createHash("sha256").update(input, "utf8").digest("hex");
}

/** canonical JSON 的同步摘要（server-only，Node crypto）。 */
export function digestCanonicalJsonSync(value: unknown): Sha256Digest {
 return `sha256:${sha256Hex(canonicalJsonString(value))}`;
}

/** 只对 AppUiBundle 计算的摘要（浏览器可核对）。 */
export function uiBundleDigest(uiBundle: unknown): Sha256Digest {
 return digestCanonicalJsonSync(uiBundle);
}

/** 完整 ApplicationCandidate 摘要（server-only，不可变 Candidate 标识）。 */
export function candidateDigest(candidate: unknown): Sha256Digest {
 return digestCanonicalJsonSync(candidate);
}

/** NextAppSpec 投影摘要。 */
export function specDigest(spec: unknown): Sha256Digest {
 return digestCanonicalJsonSync(spec);
}

/** 有界 ValidationReport 摘要（不参与 Candidate 身份）。 */
export function reportDigest(report: unknown): Sha256Digest {
 return digestCanonicalJsonSync(report);
}

/** 业务数据 Schema 摘要。 */
export function businessSchemaDigest(schema: unknown): Sha256Digest {
 return digestCanonicalJsonSync(schema);
}

/** 幂等 requestHash：canonical 参数 → sha256。 */
export function requestHash(params: unknown): Sha256Digest {
 return digestCanonicalJsonSync(params);
}
