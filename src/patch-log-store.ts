/**
 * 内存 Patch 日志（不落盘）：按 generationId 记录 spec.patch.* 文本片段，
 * 供生成活动卡的可折叠“技术详情”展示。不进入聊天记录或普通日志。
 */

export type PatchLogEntry = { at: number; text: string };

export class PatchLogStore {
  private logs = new Map<string, PatchLogEntry[]>();
  private listeners = new Set<() => void>();
  /** 单调递增版本号，作为 useSyncExternalStore 的稳定快照。 */
  version = 0;

  append(generationId: string, text: string): void {
    const entries = this.logs.get(generationId) ?? [];
    entries.push({ at: Date.now(), text });
    this.logs.set(generationId, entries);
    this.notify();
  }

  get(generationId: string): readonly PatchLogEntry[] {
    return this.logs.get(generationId) ?? [];
  }

  generationIds(): string[] {
    return [...this.logs.keys()];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

export const patchLogStore = new PatchLogStore();
