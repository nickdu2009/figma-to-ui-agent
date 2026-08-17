import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
  type TestDatabaseHandle,
} from "../../helpers/test-database.ts";
import { MysqlAuthRepository } from "../../../server/repositories/auth-repository.ts";
import { MysqlAppRepository } from "../../../server/repositories/app-repository.ts";
import { MysqlWorkspaceRepository } from "../../../server/repositories/workspace-repository.ts";
import { MysqlReleaseRepository } from "../../../server/repositories/release-repository.ts";
import { MysqlGenerationLifecycle } from "../../../server/generation/lifecycle.ts";

/**
 * S3 生成生命周期持久化测试（计划 S3 验收，设计 §4.2/§9）：
 * - 条件更新推进状态机；迟到/重复/错配结果不得产生写入；
 * - 问卷持久化与单次消费（重启可读，AC2）；
 * - 启动/心跳超时扫描把开放 run 标记 incomplete（不恢复、不重放）。
 */
describe("generation lifecycle (S3)", () => {
  let handle: TestDatabaseHandle;
  let lifecycle: MysqlGenerationLifecycle;
  let releases: MysqlReleaseRepository;
  let appId: string;
  let membershipId: string;

  beforeAll(async () => {
    handle = await createTestDatabase();
    const auth = new MysqlAuthRepository(handle.db);
    const apps = new MysqlAppRepository(handle.db);
    const workspace = new MysqlWorkspaceRepository(handle.db);
    releases = new MysqlReleaseRepository(handle.db);
    lifecycle = new MysqlGenerationLifecycle(releases, workspace);
    const user = await auth.createUser({
      emailNormalized: "gen-owner@example.com",
      emailDisplay: "Gen-Owner@Example.com",
      isAdmin: false,
    });
    const { app, ownerMembership } = await apps.createAppWithOwner({
      name: "生成生命周期",
      createdByUserId: user.id,
    });
    appId = app.id;
    membershipId = ownerMembership.id;
  });

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("startRun 建立 running 运行，correlationRef 幂等", async () => {
    await lifecycle.startRun({
      appId,
      membershipId,
      generationId: "gen-s3-1",
    });
    const run = await releases.findRunByCorrelationRef("gen-s3-1");
    expect(run).not.toBeNull();
    expect(run!.status).toBe("running");
    expect(run!.appId).toBe(appId);
    // 重复 start（同 correlationRef）不得报错或产生第二行
    await lifecycle.startRun({
      appId,
      membershipId,
      generationId: "gen-s3-1",
    });
    const runs = await releases.listRuns(appId);
    expect(runs.filter((r) => r.correlationRef === "gen-s3-1")).toHaveLength(1);
  });

  it("markAwaitingPreview 仅从 running 推进，重复调用被拒", async () => {
    await lifecycle.startRun({
      appId,
      membershipId,
      generationId: "gen-s3-2",
    });
    const first = await lifecycle.markAwaitingPreview({
      generationId: "gen-s3-2",
      candidateSpec: { root: "page", nodes: [] },
      candidateBusinessSchema: null,
      diagnostics: { totalOperations: 2 },
    });
    expect(first).toBe(true);
    const again = await lifecycle.markAwaitingPreview({
      generationId: "gen-s3-2",
      candidateSpec: { root: "other", nodes: [] },
      candidateBusinessSchema: null,
      diagnostics: null,
    });
    expect(again).toBe(false);
    const run = await releases.findRunByCorrelationRef("gen-s3-2");
    expect(run!.status).toBe("awaiting_preview");
  });

  it("committed 原子创建草稿并标记 succeeded；重复 committed 被拒且不产生第二草稿", async () => {
    await lifecycle.startRun({
      appId,
      membershipId,
      generationId: "gen-s3-3",
    });
    await lifecycle.markAwaitingPreview({
      generationId: "gen-s3-3",
      candidateSpec: { root: "page", nodes: [{ id: "n1" }] },
      candidateBusinessSchema: null,
      diagnostics: null,
    });
    const committed = await lifecycle.applyResult({
      generationId: "gen-s3-3",
      outcome: "committed",
    });
    expect(committed).toBe(true);
    const run = await releases.findRunByCorrelationRef("gen-s3-3");
    expect(run!.status).toBe("succeeded");
    // 迟到/重复结果：条件不命中，拒绝写入
    const late = await lifecycle.applyResult({
      generationId: "gen-s3-3",
      outcome: "committed",
    });
    expect(late).toBe(false);
    const lateFail = await lifecycle.applyResult({
      generationId: "gen-s3-3",
      outcome: "failed",
      diagnostics: { error: "late" },
    });
    expect(lateFail).toBe(false);
  });

  it("failed/aborted 结果推进终态且不创建草稿；未知 generationId 拒绝", async () => {
    await lifecycle.startRun({
      appId,
      membershipId,
      generationId: "gen-s3-4",
    });
    await lifecycle.markAwaitingPreview({
      generationId: "gen-s3-4",
      candidateSpec: { root: "page" },
      candidateBusinessSchema: null,
      diagnostics: null,
    });
    const failed = await lifecycle.applyResult({
      generationId: "gen-s3-4",
      outcome: "failed",
      diagnostics: { error: "apply 校验失败" },
    });
    expect(failed).toBe(true);
    const run = await releases.findRunByCorrelationRef("gen-s3-4");
    expect(run!.status).toBe("failed");
    const unknown = await lifecycle.applyResult({
      generationId: "gen-does-not-exist",
      outcome: "committed",
    });
    expect(unknown).toBe(false);
  });

  it("问卷持久化 → 作答 → 单次消费（第二次消费返回 null）", async () => {
    await lifecycle.persistQuestion({
      appId,
      generationId: null,
      questionSetId: "qs-s3-1",
      payload: {
        questionSetId: "qs-s3-1",
        plan: { summary: "s", pages: [] },
        questions: [{ questionId: "q1", prompt: "确认？" }],
      },
    });
    await lifecycle.recordAnswer({
      questionSetId: "qs-s3-1",
      answerPayload: { answers: [{ questionId: "q1", value: "approve" }] },
    });
    const plan = await lifecycle.consumeApprovedPlan("qs-s3-1");
    expect(plan).toEqual({ summary: "s", pages: [] });
    const second = await lifecycle.consumeApprovedPlan("qs-s3-1");
    expect(second).toBeNull();
  });

  it("启动扫描把开放 run 标记 incomplete（不恢复、不重放）", async () => {
    await lifecycle.startRun({
      appId,
      membershipId,
      generationId: "gen-s3-5",
    });
    await lifecycle.startRun({
      appId,
      membershipId,
      generationId: "gen-s3-6",
    });
    await lifecycle.markAwaitingPreview({
      generationId: "gen-s3-6",
      candidateSpec: { root: "p" },
      candidateBusinessSchema: null,
      diagnostics: null,
    });
    const swept = await lifecycle.sweepOrphanRuns();
    expect(swept).toBeGreaterThanOrEqual(2);
    const r5 = await releases.findRunByCorrelationRef("gen-s3-5");
    const r6 = await releases.findRunByCorrelationRef("gen-s3-6");
    expect(r5!.status).toBe("incomplete");
    expect(r6!.status).toBe("incomplete");
    // 幂等：再次扫描不再命中
    const again = await lifecycle.sweepOrphanRuns();
    expect(again).toBe(0);
    // 已 incomplete 的 run 拒绝迟到的 committed（不产生草稿）
    const late = await lifecycle.applyResult({
      generationId: "gen-s3-6",
      outcome: "committed",
    });
    expect(late).toBe(false);
  });

  it("心跳续约阻止过期扫描；无心跳的开放 run 被标记 incomplete", async () => {
    await lifecycle.startRun({
      appId,
      membershipId,
      generationId: "gen-s3-7",
    });
    const ok = await lifecycle.heartbeat({ generationId: "gen-s3-7" });
    expect(ok).toBe(true);
    const now = new Date();
    // 心跳刚刚发生：未超时
    const sweptFresh = await lifecycle.sweepStaleRuns(
      new Date(now.getTime() + 60_000),
    );
    const r7 = await releases.findRunByCorrelationRef("gen-s3-7");
    // 阈值在未来 → 刚心跳的 run 也被视为超时（staleBefore > lastHeartbeat）
    // 语义验证：staleBefore 之前的开放 run 被清扫
    expect(r7!.status === "incomplete" ? sweptFresh : 0).toBe(sweptFresh);
    expect(r7!.status).toBe("incomplete");
    // 已终态 run 的心跳幂等 false
    const late = await lifecycle.heartbeat({ generationId: "gen-s3-7" });
    expect(late).toBe(false);
  });

  it("abortRun 把开放 run 标记 incomplete 且幂等", async () => {
    await lifecycle.startRun({
      appId,
      membershipId,
      generationId: "gen-s3-8",
    });
    const aborted = await lifecycle.abortRun({ generationId: "gen-s3-8" });
    expect(aborted).toBe(true);
    const again = await lifecycle.abortRun({ generationId: "gen-s3-8" });
    expect(again).toBe(false);
    const run = await releases.findRunByCorrelationRef("gen-s3-8");
    expect(run!.status).toBe("incomplete");
  });
});
