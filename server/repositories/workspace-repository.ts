import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../persistence/database.ts";
import {
  appPlans,
  chatMessages,
  chatThreads,
  generationLogs,
  questionAnswers,
  questionSets,
  type AppPlanRow,
  type ChatMessageRow,
  type ChatThreadRow,
  type GenerationLogRow,
  type QuestionAnswerRow,
  type QuestionSetRow,
} from "../db/schema.ts";
import {
  isDuplicateEntry,
  NotFoundError,
  RevisionConflictError,
} from "./errors.ts";

/**
 * WorkspaceRepository：聊天、问卷、答案、计划、技术日志的唯一事实 owner。
 * 工作数据仅应用所有者可读——授权在服务/中间件层执行（设计 §4.3）。
 * S3 在此扩展问卷/计划/日志。
 */

export interface WorkspaceRepository {
  createThread(input: {
    appId: string;
    title?: string;
  }): Promise<ChatThreadRow>;
  findThreadById(id: string): Promise<ChatThreadRow | null>;
  /**
   * 追加消息并同事务推进 thread revision（expectedRevision 条件更新）。
   * 冲突时整个事务回滚：消息不落库（无部分写入）。
   */
  appendMessage(input: {
    threadId: string;
    role: string;
    content: string;
    expectedThreadRevision: number;
  }): Promise<ChatMessageRow>;
  listMessages(threadId: string): Promise<ChatMessageRow[]>;
  /** 按应用列出聊天线程（工作区恢复）。 */
  listThreads(appId: string): Promise<ChatThreadRow[]>;
  /** 按 AG-UI threadId 获取或创建线程（幂等）。 */
  ensureThreadByCorrelation(input: {
    appId: string;
    correlationRef: string;
  }): Promise<ChatThreadRow>;
  /** 幂等追加消息（按 AG-UI message id 去重；重复投递返回 null）。 */
  appendMessageDeduped(input: {
    threadId: string;
    correlationRef: string;
    role: string;
    content: string;
  }): Promise<ChatMessageRow | null>;

  // ---------- 问卷 / 答案 / 计划 / 技术日志（S3，设计 §4.3） ----------

  createQuestionSet(input: {
    appId: string;
    generationRunId: string | null;
    correlationRef: string;
    payload: unknown;
    status: string;
  }): Promise<QuestionSetRow>;
  findQuestionSetById(id: string): Promise<QuestionSetRow | null>;
  findQuestionSetByCorrelationRef(
    correlationRef: string,
  ): Promise<QuestionSetRow | null>;
  /** 记录答案并原子推进 open → answered（同事务）。 */
  recordAnswerAndMarkAnswered(input: {
    questionSetId: string;
    answerPayload: unknown;
  }): Promise<boolean>;
  /**
   * 原子消费已回答问卷（answered → consumed）。
   * 返回计划 payload；重复消费/状态不符返回 null（fail-closed）。
   */
  consumeAnsweredQuestionSet(correlationRef: string): Promise<unknown | null>;
  listQuestionSets(appId: string): Promise<QuestionSetRow[]>;
  createAnswer(input: {
    questionSetId: string;
    payload: unknown;
  }): Promise<QuestionAnswerRow>;
  listAnswers(questionSetId: string): Promise<QuestionAnswerRow[]>;
  createPlan(input: {
    appId: string;
    generationRunId: string | null;
    payload: unknown;
  }): Promise<AppPlanRow>;
  listPlans(appId: string): Promise<AppPlanRow[]>;
  appendLog(input: {
    appId: string;
    generationRunId: string | null;
    level: string;
    message: string;
  }): Promise<GenerationLogRow>;
  listLogs(input: {
    appId: string;
    generationRunId?: string;
    limit: number;
  }): Promise<GenerationLogRow[]>;
}

export class MysqlWorkspaceRepository implements WorkspaceRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  async createThread(input: {
    appId: string;
    title?: string;
  }): Promise<ChatThreadRow> {
    const now = new Date();
    const row: ChatThreadRow = {
      id: randomUUID(),
      appId: input.appId,
      correlationRef: null,
      title: input.title ?? null,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    await this.db.insert(chatThreads).values(row);
    return row;
  }

  async findThreadById(id: string): Promise<ChatThreadRow | null> {
    const rows = await this.db
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async appendMessage(input: {
    threadId: string;
    role: string;
    content: string;
    expectedThreadRevision: number;
  }): Promise<ChatMessageRow> {
    const now = new Date();
    const message: ChatMessageRow = {
      id: randomUUID(),
      threadId: input.threadId,
      correlationRef: null,
      role: input.role,
      content: input.content,
      createdAt: now,
    };
    return this.db.transaction(async (tx) => {
      // expectedRevision 条件更新：并发下只有一个事务能推进 revision
      const [result] = await tx
        .update(chatThreads)
        .set({
          updatedAt: now,
          revision: input.expectedThreadRevision + 1,
        })
        .where(
          and(
            eq(chatThreads.id, input.threadId),
            eq(chatThreads.revision, input.expectedThreadRevision),
          ),
        );
      if (result.affectedRows === 0) {
        const existing = await tx
          .select()
          .from(chatThreads)
          .where(eq(chatThreads.id, input.threadId))
          .limit(1);
        if (!existing[0]) throw new NotFoundError("聊天线程不存在");
        throw new RevisionConflictError(
          `聊天线程 revision 冲突：期望 ${input.expectedThreadRevision}，当前 ${existing[0].revision}`,
        );
      }
      await tx.insert(chatMessages).values(message);
      return message;
    });
  }

  async listMessages(threadId: string): Promise<ChatMessageRow[]> {
    return this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
  }

  async listThreads(appId: string): Promise<ChatThreadRow[]> {
    return this.db
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.appId, appId))
      .orderBy(asc(chatThreads.createdAt));
  }

  async createQuestionSet(input: {
    appId: string;
    generationRunId: string | null;
    correlationRef: string;
    payload: unknown;
    status: string;
  }): Promise<QuestionSetRow> {
    const row: QuestionSetRow = {
      id: randomUUID(),
      appId: input.appId,
      generationRunId: input.generationRunId,
      correlationRef: input.correlationRef,
      payload: input.payload,
      status: input.status,
      createdAt: new Date(),
      revision: 1,
    };
    await this.db.insert(questionSets).values(row);
    return row;
  }

  async ensureThreadByCorrelation(input: {
    appId: string;
    correlationRef: string;
  }): Promise<ChatThreadRow> {
    const existing = await this.db
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.correlationRef, input.correlationRef))
      .limit(1);
    if (existing[0]) return existing[0];
    const now = new Date();
    const row: ChatThreadRow = {
      id: randomUUID(),
      appId: input.appId,
      correlationRef: input.correlationRef,
      title: null,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    try {
      await this.db.insert(chatThreads).values(row);
    } catch (error) {
      if (isDuplicateEntry(error)) {
        // 并发创建：读回已有线程（幂等）
        const again = await this.db
          .select()
          .from(chatThreads)
          .where(eq(chatThreads.correlationRef, input.correlationRef))
          .limit(1);
        if (again[0]) return again[0];
      }
      throw error;
    }
    return row;
  }

  async appendMessageDeduped(input: {
    threadId: string;
    correlationRef: string;
    role: string;
    content: string;
  }): Promise<ChatMessageRow | null> {
    const row: ChatMessageRow = {
      id: randomUUID(),
      threadId: input.threadId,
      correlationRef: input.correlationRef,
      role: input.role,
      content: input.content,
      createdAt: new Date(),
    };
    try {
      await this.db.insert(chatMessages).values(row);
    } catch (error) {
      if (isDuplicateEntry(error)) return null; // 重复投递：幂等忽略
      throw error;
    }
    return row;
  }

  async findQuestionSetByCorrelationRef(
    correlationRef: string,
  ): Promise<QuestionSetRow | null> {
    const rows = await this.db
      .select()
      .from(questionSets)
      .where(eq(questionSets.correlationRef, correlationRef))
      .limit(1);
    return rows[0] ?? null;
  }

  async recordAnswerAndMarkAnswered(input: {
    questionSetId: string;
    answerPayload: unknown;
  }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(questionSets)
        .set({ status: "answered" })
        .where(
          and(
            eq(questionSets.id, input.questionSetId),
            eq(questionSets.status, "open"),
          ),
        );
      if (updated.affectedRows === 0) return false;
      await tx.insert(questionAnswers).values({
        id: randomUUID(),
        questionSetId: input.questionSetId,
        payload: input.answerPayload,
        createdAt: new Date(),
      });
      return true;
    });
  }

  async consumeAnsweredQuestionSet(
    correlationRef: string,
  ): Promise<unknown | null> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(questionSets)
        .set({ status: "consumed" })
        .where(
          and(
            eq(questionSets.correlationRef, correlationRef),
            eq(questionSets.status, "answered"),
          ),
        );
      if (updated.affectedRows === 0) return null;
      const rows = await tx
        .select()
        .from(questionSets)
        .where(eq(questionSets.correlationRef, correlationRef))
        .limit(1);
      return rows[0]?.payload ?? null;
    });
  }

  async findQuestionSetById(id: string): Promise<QuestionSetRow | null> {
    const rows = await this.db
      .select()
      .from(questionSets)
      .where(eq(questionSets.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listQuestionSets(appId: string): Promise<QuestionSetRow[]> {
    return this.db
      .select()
      .from(questionSets)
      .where(eq(questionSets.appId, appId))
      .orderBy(asc(questionSets.createdAt));
  }

  async createAnswer(input: {
    questionSetId: string;
    payload: unknown;
  }): Promise<QuestionAnswerRow> {
    const row: QuestionAnswerRow = {
      id: randomUUID(),
      questionSetId: input.questionSetId,
      payload: input.payload,
      createdAt: new Date(),
    };
    await this.db.insert(questionAnswers).values(row);
    return row;
  }

  async listAnswers(questionSetId: string): Promise<QuestionAnswerRow[]> {
    return this.db
      .select()
      .from(questionAnswers)
      .where(eq(questionAnswers.questionSetId, questionSetId))
      .orderBy(asc(questionAnswers.createdAt));
  }

  async createPlan(input: {
    appId: string;
    generationRunId: string | null;
    payload: unknown;
  }): Promise<AppPlanRow> {
    const row: AppPlanRow = {
      id: randomUUID(),
      appId: input.appId,
      generationRunId: input.generationRunId,
      payload: input.payload,
      createdAt: new Date(),
      revision: 1,
    };
    await this.db.insert(appPlans).values(row);
    return row;
  }

  async listPlans(appId: string): Promise<AppPlanRow[]> {
    return this.db
      .select()
      .from(appPlans)
      .where(eq(appPlans.appId, appId))
      .orderBy(asc(appPlans.createdAt));
  }

  async appendLog(input: {
    appId: string;
    generationRunId: string | null;
    level: string;
    message: string;
  }): Promise<GenerationLogRow> {
    const row: GenerationLogRow = {
      id: randomUUID(),
      appId: input.appId,
      generationRunId: input.generationRunId,
      level: input.level,
      message: input.message,
      createdAt: new Date(),
    };
    await this.db.insert(generationLogs).values(row);
    return row;
  }

  async listLogs(input: {
    appId: string;
    generationRunId?: string;
    limit: number;
  }): Promise<GenerationLogRow[]> {
    const conditions = [eq(generationLogs.appId, input.appId)];
    if (input.generationRunId) {
      conditions.push(
        eq(generationLogs.generationRunId, input.generationRunId),
      );
    }
    return this.db
      .select()
      .from(generationLogs)
      .where(and(...conditions))
      .orderBy(asc(generationLogs.createdAt))
      .limit(input.limit);
  }
}
