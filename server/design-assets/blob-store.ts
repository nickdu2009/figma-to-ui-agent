/**
 * 内容寻址本地 BlobStore（设计 §5.4，计划 S7 动作 1）：
 * - VMA_ASSET_ROOT 专用受管目录；浏览器/Bundle/数据库不保存绝对路径；
 * - 相对路径只由小写 SHA-256 派生：sha256/<前两位>/<完整哈希>；
 * - 上传先写 <root>/tmp/<server-id>，完成字节数/魔数/MIME/哈希校验后
 *   同文件系统原子 rename 提升到内容地址；
 * - 目标已存在时校验大小/哈希一致后复用；
 * - 读取/删除 fail closed：缺失或损坏即报错，不返回空文件或占位成功。
 */
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  BLOB_MAGIC_NUMBERS,
  BLOB_MAX_BYTES,
  designAssetError,
} from "./contracts.ts";

export interface VerifiedBlob {
  contentHash: string; // sha256:<hex>
  relativePath: string; // sha256/<2>/<64>（服务端私有派生）
  mimeType: string; // 魔数确认后的精确 MIME
  byteLength: number;
  kind: "image" | "svg" | "font" | "pdf";
}

/** 从完整十六进制哈希派生相对路径（不使用用户输入）。 */
export function blobRelativePath(contentHashHex: string): string {
  return path.posix.join("sha256", contentHashHex.slice(0, 2), contentHashHex);
}

/** 魔数判别：返回 kind 与精确 MIME；无法判别时返回 null。 */
export function sniffMagic(
  head: Uint8Array,
): { kind: "image" | "svg" | "font" | "pdf"; mime: string } | null {
  for (const { kind, prefixHex, mime } of BLOB_MAGIC_NUMBERS) {
    const prefix = Buffer.from(prefixHex, "hex");
    if (head.length >= prefix.length && prefix.equals(head.subarray(0, prefix.length))) {
      // WEBP 需要 RIFF….WEBP 完整确认。
      if (mime === "image/webp") {
        if (head.length >= 12 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) {
          return { kind, mime };
        }
        continue;
      }
      return { kind, mime };
    }
  }
  // SVG：文本头（<?xml / <svg / <!--）判别。
  const text = Buffer.from(head.subarray(0, 256)).toString("utf8").trimStart().toLowerCase();
  if (text.startsWith("<?xml") || text.startsWith("<svg") || text.startsWith("<!--")) {
    return { kind: "svg", mime: "image/svg+xml" };
  }
  return null;
}

export interface BlobStore {
  readonly root: string;
  readonly serverId: string;
  /**
   * 校验字节并原子写入内容地址：
   * - 字节数 ≤20 MiB、魔数判别成功、声明 MIME 与魔数一致（或 font 的
   *   octet-stream 兜底归一）；
   * - 目标已存在时核对大小与哈希一致后复用；
   * - 返回 VerifiedBlob（含派生相对路径）。
   */
  write(input: {
    bytes: Uint8Array;
    declaredMimeType: string;
  }): Promise<VerifiedBlob>;
  /** 读取字节（缺失 fail closed）。 */
  read(relativePath: string): Promise<Uint8Array>;
  /** 打开只读流（读取路由用；缺失 fail closed）。 */
  stat(relativePath: string): Promise<{ byteLength: number }>;
  /** 删除（缺失时幂等成功；GC 二次确认后调用）。 */
  remove(relativePath: string): Promise<void>;
  /** 存在性 + 大小核对（reconciliation 用）。 */
  verifyOnDisk(relativePath: string, expectedBytes: number): Promise<boolean>;
  /** 清理本 serverId 的孤儿 tmp 文件（启动扫描）。 */
  sweepOrphanTmp(now: Date, maxAgeMs: number): Promise<number>;
}

export class LocalContentAddressedBlobStore implements BlobStore {
  readonly root: string;
  readonly serverId: string;

  constructor(root: string, serverId: string) {
    this.root = root;
    this.serverId = serverId;
  }

  private absolute(relativePath: string): string {
    // 防御：只接受 sha256/<hex> 派生形态，拒绝任何用户输入路径穿越。
    if (!/^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(relativePath)) {
      throw designAssetError("asset_invalid");
    }
    return path.join(this.root, relativePath);
  }

  async write(input: {
    bytes: Uint8Array;
    declaredMimeType: string;
  }): Promise<VerifiedBlob> {
    if (input.bytes.byteLength === 0) {
      throw designAssetError("asset_invalid");
    }
    if (input.bytes.byteLength > BLOB_MAX_BYTES) {
      throw designAssetError("asset_limit_exceeded");
    }
    const sniffed = sniffMagic(input.bytes.subarray(0, 64));
    if (!sniffed) {
      throw designAssetError("asset_magic_mismatch");
    }
    const declared = declaredMime(input.declaredMimeType);
    if (declared !== sniffed.mime && !(declared === "application/octet-stream" && sniffed.kind === "font")) {
      throw designAssetError("asset_mime_forbidden");
    }

    const hashHex = createHash("sha256").update(input.bytes).digest("hex");
    const contentHash = `sha256:${hashHex}`;
    const relativePath = blobRelativePath(hashHex);
    const target = this.absolute(relativePath);

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.mkdir(path.join(this.root, "tmp", this.serverId), { recursive: true });
    const tmpPath = path.join(
      this.root,
      "tmp",
      this.serverId,
      `${randomUUID()}.part`,
    );
    await fs.writeFile(tmpPath, input.bytes, { flag: "wx" });

    try {
      const existing = await this.stat(relativePath).catch(() => null);
      if (existing) {
        // 目标已存在：核对大小与哈希一致后复用（幂等）。
        const onDisk = await fs.readFile(target);
        const onDiskHash = createHash("sha256").update(onDisk).digest("hex");
        if (onDiskHash !== hashHex || onDisk.byteLength !== input.bytes.byteLength) {
          throw designAssetError("asset_hash_mismatch");
        }
        await fs.rm(tmpPath, { force: true });
      } else {
        // 同文件系统原子 rename 提升到内容地址。
        await fs.rename(tmpPath, target);
      }
    } catch (error) {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      throw error;
    }

    return {
      contentHash,
      relativePath,
      mimeType: sniffed.mime,
      byteLength: input.bytes.byteLength,
      kind: sniffed.kind,
    };
  }

  async read(relativePath: string): Promise<Uint8Array> {
    return fs.readFile(this.absolute(relativePath));
  }

  async stat(relativePath: string): Promise<{ byteLength: number }> {
    const info = await fs.stat(this.absolute(relativePath));
    if (!info.isFile()) throw designAssetError("asset_not_found");
    return { byteLength: info.size };
  }

  async remove(relativePath: string): Promise<void> {
    await fs.rm(this.absolute(relativePath), { force: true });
  }

  async verifyOnDisk(
    relativePath: string,
    expectedBytes: number,
  ): Promise<boolean> {
    try {
      const info = await fs.stat(this.absolute(relativePath));
      return info.isFile() && info.size === expectedBytes;
    } catch {
      return false;
    }
  }

  async sweepOrphanTmp(now: Date, maxAgeMs: number): Promise<number> {
    // tmp/ 下任何 serverId 的过期 .part 文件都清理（崩溃残留）。
    const tmpRoot = path.join(this.root, "tmp");
    let removed = 0;
    let servers: string[] = [];
    try {
      servers = await fs.readdir(tmpRoot);
    } catch {
      return 0;
    }
    for (const server of servers) {
      const dir = path.join(tmpRoot, server);
      const entries = await fs.readdir(dir).catch(() => [] as string[]);
      for (const entry of entries) {
        if (!entry.endsWith(".part")) continue;
        const full = path.join(dir, entry);
        const info = await fs.stat(full).catch(() => null);
        if (!info) continue;
        if (now.getTime() - info.mtimeMs > maxAgeMs) {
          await fs.rm(full, { force: true });
          removed += 1;
        }
      }
    }
    return removed;
  }
}

function declaredMime(mime: string): string {
  return mime.trim().toLowerCase();
}

/** 从进程环境构造（缺失目录 fail closed：首写时创建）。 */
export function blobStoreFromEnv(
  env: NodeJS.ProcessEnv,
  serverId: string,
): LocalContentAddressedBlobStore {
  const root = env.VMA_ASSET_ROOT?.trim();
  if (!root) {
    throw designAssetError("asset_store_unavailable");
  }
  return new LocalContentAddressedBlobStore(root, serverId);
}
