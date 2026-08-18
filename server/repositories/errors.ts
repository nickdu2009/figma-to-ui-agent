/** Repository 层错误：携带机器可读 code，供路由层映射 HTTP 状态。 */
export class RepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RepositoryError";
    this.code = code;
  }
}

/** expectedRevision 条件更新未命中（409 conflict 语义，设计 §6.3）。 */
export class RevisionConflictError extends RepositoryError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("revision_conflict", message, options);
    this.name = "RevisionConflictError";
  }
}

export class NotFoundError extends RepositoryError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("not_found", message, options);
    this.name = "NotFoundError";
  }
}

/** MySQL 唯一约束冲突（errno 1062）映射。 */
export class UniqueConstraintError extends RepositoryError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("unique_constraint", message, options);
    this.name = "UniqueConstraintError";
  }
}

export function isDuplicateEntry(error: unknown): boolean {
  // drizzle 会把驱动错误包在 cause 链上，沿链检查 mysql errno 1062
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    if ("errno" in current && (current as { errno: unknown }).errno === 1062) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
