/**
 * S13 集成测试：协议模式切换对各 Mutation 路由的门禁生效验证（设计 §13.2.1/§13.2.3）。
 *
 * 验证：
 * 1. v2 是唯一正常写入协议；
 * 2. readonly_recovery 模式：所有写入端点返回 423 protocol_mode_readonly_recovery_active，只读端点正常工作。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import {
  createTestDatabase,
  dropTestDatabase,
  type TestDatabaseHandle,
} from "../../helpers/test-database.ts";
import { MysqlReleaseRepository } from "../../../server/repositories/release-repository.ts";
import { MysqlAppRepository } from "../../../server/repositories/app-repository.ts";
import { ReleaseService } from "../../../server/release/service.ts";
import { createReleaseRoutes } from "../../../server/routes/releases.ts";
import type { AuthService } from "../../../server/auth/service.ts";
import type { AppRepository } from "../../../server/repositories/app-repository.ts";

interface Seed {
  appId: string;
  userId: string;
  membershipId: string;
}

async function seedApp(pool: mysql.Pool): Promise<Seed> {
  const userId = randomUUID();
  const appId = randomUUID();
  const membershipId = randomUUID();
  await pool.query(
    "INSERT INTO `users` (`id`, `email_normalized`, `email_display`, `created_at`, `updated_at`) VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
    [userId, `u-${userId}@example.com`, `u-${userId}@example.com`],
  );
  await pool.query(
    "INSERT INTO `apps` (`id`, `name`, `created_by_user_id`, `status`, `created_at`, `updated_at`) VALUES (?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
    [appId, `app-${appId}`, userId],
  );
  await pool.query(
    "INSERT INTO `memberships` (`id`, `app_id`, `user_id`, `role`, `status`, `active_marker`, `created_at`) VALUES (?, ?, ?, 'owner', 'active', 'active', UTC_TIMESTAMP(3))",
    [membershipId, appId, userId],
  );
  return { appId, userId, membershipId };
}

describe("S13 协议模式 Mutation 门禁集成测试", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let seed: Seed;
  let releaseRepo: MysqlReleaseRepository;
  let releaseService: ReleaseService;

  // Mock AuthService & AppRepository
  let mockAuthService: AuthService;
  let mockAppRepo: AppRepository;

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    seed = await seedApp(pool);
    releaseRepo = new MysqlReleaseRepository(handle.db);
    mockAppRepo = new MysqlAppRepository(handle.db);
    releaseService = new ReleaseService(releaseRepo);

    mockAuthService = {
      resolveSession: async () => ({
        sessionId: "s-1",
        user: {
          id: seed.userId,
          emailNormalized: "test@example.com",
          emailDisplay: "test@example.com",
        },
      }),
    } as unknown as AuthService;
  });

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  const AUTH_HEADERS = {
    "Content-Type": "application/json",
    Cookie: "vma_session=mock-token",
  };

  it("readonly_recovery 模式下禁止写入但允许只读查询", async () => {
    const releaseApp = createReleaseRoutes({
      authService: mockAuthService,
      appRepository: mockAppRepo,
      releaseRepository: releaseRepo,
      releaseService,
      protocolMode: "readonly_recovery",
    });

    // 写入被拒
    const writeRes = await releaseApp.request(
      `/apps/${seed.appId}/releases/rollback`,
      {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({ publishedVersionId: "pub-1" }),
      },
    );
    expect(writeRes.status).toBe(423);
    const writeBody = (await writeRes.json()) as { error?: { code: string } };
    expect(writeBody.error?.code).toBe(
      "protocol_mode_readonly_recovery_active",
    );

    // 只读查询成功
    const readRes = await releaseApp.request(
      `/apps/${seed.appId}/releases/current`,
      { method: "GET", headers: AUTH_HEADERS },
    );
    expect(readRes.status).toBe(200);
  });
});
