import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
  reconnectTestDatabase,
  type TestDatabaseHandle,
} from "../../helpers/test-database.ts";
import { MysqlAuthRepository } from "../../../server/repositories/auth-repository.ts";
import { MysqlAppRepository } from "../../../server/repositories/app-repository.ts";
import { MysqlWorkspaceRepository } from "../../../server/repositories/workspace-repository.ts";
import {
  RevisionConflictError,
  UniqueConstraintError,
} from "../../../server/repositories/errors.ts";

let handle: TestDatabaseHandle;

beforeAll(async () => {
  handle = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(handle);
});

describe("AuthRepository", () => {
  it("创建用户并可按规范化邮箱读回；重复邮箱唯一约束失败", async () => {
    const repo = new MysqlAuthRepository(handle.db);
    const user = await repo.createUser({
      emailNormalized: "owner@example.com",
      emailDisplay: "Owner@Example.com",
      isAdmin: false,
    });
    const found = await repo.findUserByEmailNormalized("owner@example.com");
    expect(found?.id).toBe(user.id);
    await expect(
      repo.createUser({
        emailNormalized: "owner@example.com",
        emailDisplay: "Owner@Example.com",
        isAdmin: false,
      }),
    ).rejects.toBeInstanceOf(UniqueConstraintError);
  });

  it("认证挑战单次消费是原子的：第一次成功，第二次失败", async () => {
    const repo = new MysqlAuthRepository(handle.db);
    const challenge = await repo.createChallenge({
      emailNormalized: "login@example.com",
      method: "otp",
      tokenDigest: "a".repeat(64),
      expiresAt: new Date(Date.now() + 600_000),
      now: new Date(),
    });
    expect(await repo.consumeChallenge(challenge.id, new Date())).toBe(true);
    expect(await repo.consumeChallenge(challenge.id, new Date())).toBe(false);
  });

  it("会话创建/读回/删除；登出后立即失效", async () => {
    const repo = new MysqlAuthRepository(handle.db);
    const user = await repo.createUser({
      emailNormalized: "session@example.com",
      emailDisplay: "Session@Example.com",
      isAdmin: false,
    });
    const session = await repo.createSession({
      userId: user.id,
      tokenDigest: "b".repeat(64),
      expiresAt: new Date(Date.now() + 600_000),
      now: new Date(),
    });
    expect((await repo.findSessionByTokenDigest("b".repeat(64)))?.id).toBe(
      session.id,
    );
    await repo.deleteSession(session.id);
    expect(await repo.findSessionByTokenDigest("b".repeat(64))).toBeNull();
  });
});

describe("AppRepository", () => {
  it("createAppWithOwner 同事务建立应用与 owner 成员关系", async () => {
    const auth = new MysqlAuthRepository(handle.db);
    const repo = new MysqlAppRepository(handle.db);
    const user = await auth.createUser({
      emailNormalized: "app-owner@example.com",
      emailDisplay: "App-Owner@Example.com",
      isAdmin: false,
    });
    const { app, ownerMembership } = await repo.createAppWithOwner({
      name: "订单管理",
      createdByUserId: user.id,
    });
    expect(app.status).toBe("active");
    expect(ownerMembership.role).toBe("owner");
    expect(ownerMembership.status).toBe("active");
    const found = await repo.findActiveMembership(app.id, user.id);
    expect(found?.id).toBe(ownerMembership.id);
  });

  it("renameApp 按 expectedRevision 条件更新；陈旧 revision 报 409 冲突", async () => {
    const auth = new MysqlAuthRepository(handle.db);
    const repo = new MysqlAppRepository(handle.db);
    const user = await auth.createUser({
      emailNormalized: "rename@example.com",
      emailDisplay: "Rename@Example.com",
      isAdmin: false,
    });
    const { app } = await repo.createAppWithOwner({
      name: "旧名字",
      createdByUserId: user.id,
    });
    const renamed = await repo.renameApp({
      appId: app.id,
      name: "新名字",
      expectedRevision: 1,
    });
    expect(renamed.revision).toBe(2);
    await expect(
      repo.renameApp({ appId: app.id, name: "并发覆盖", expectedRevision: 1 }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    // 冲突无部分写入：名字未被覆盖
    expect((await repo.findAppById(app.id))?.name).toBe("新名字");
  });

  it("并发首次发布：发布指针只能创建一次", async () => {
    const auth = new MysqlAuthRepository(handle.db);
    const repo = new MysqlAppRepository(handle.db);
    const user = await auth.createUser({
      emailNormalized: "pointer@example.com",
      emailDisplay: "Pointer@Example.com",
      isAdmin: false,
    });
    const { app } = await repo.createAppWithOwner({
      name: "发布",
      createdByUserId: user.id,
    });
    await repo.createReleasePointer({
      appId: app.id,
      publishedVersionId: "pv-1",
    });
    await expect(
      repo.createReleasePointer({ appId: app.id, publishedVersionId: "pv-2" }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    // 移动指针需 expectedRevision
    const moved = await repo.moveReleasePointer({
      appId: app.id,
      publishedVersionId: "pv-3",
      expectedRevision: 1,
    });
    expect(moved.publishedVersionId).toBe("pv-3");
    await expect(
      repo.moveReleasePointer({
        appId: app.id,
        publishedVersionId: "pv-4",
        expectedRevision: 1,
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });
});

describe("WorkspaceRepository", () => {
  it("appendMessage 与 thread revision 同事务推进；冲突时消息不落库", async () => {
    const repo = new MysqlWorkspaceRepository(handle.db);
    const thread = await repo.createThread({ appId: "app-x", title: "t" });
    const msg = await repo.appendMessage({
      threadId: thread.id,
      role: "user",
      content: "hello",
      expectedThreadRevision: 1,
    });
    expect(msg.content).toBe("hello");
    await expect(
      repo.appendMessage({
        threadId: thread.id,
        role: "user",
        content: "stale",
        expectedThreadRevision: 1,
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    // 无部分写入：冲突消息未落库
    const messages = await repo.listMessages(thread.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("hello");
  });
});

describe("重启恢复（AC1 种子）", () => {
  it("新建连接（模拟服务重启）后数据完整读回", async () => {
    const auth = new MysqlAuthRepository(handle.db);
    const repo = new MysqlAppRepository(handle.db);
    const user = await auth.createUser({
      emailNormalized: "restart@example.com",
      emailDisplay: "Restart@Example.com",
      isAdmin: false,
    });
    const { app } = await repo.createAppWithOwner({
      name: "重启恢复",
      createdByUserId: user.id,
    });
    const restarted = await reconnectTestDatabase(handle);
    const repo2 = new MysqlAppRepository(restarted.db);
    const found = await repo2.findAppById(app.id);
    expect(found?.name).toBe("重启恢复");
    const apps = await repo2.listAppsForUser(user.id);
    expect(apps.map((a) => a.app.id)).toContain(app.id);
    await restarted.pool.end();
  });
});
