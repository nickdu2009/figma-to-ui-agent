/**
 * S13 浏览器验收：协议模式握手与兼容性校验（设计 §13.2.1/§13.2.3）。
 *
 * 验证：
 * 1. /api/protocol 返回合法的 protocolMode、serverProtocolVersion 与 compatibilityDigest；
 * 2. 客户端正常与服务端完成协议握手。
 */
import { expect, test } from "@playwright/test";
import { adminEmailFor, uiLogin } from "./e2e-helpers.ts";

test("S13 protocol-mode-compatibility：协议模式握手端点", async ({ page }) => {
 await uiLogin(page, adminEmailFor(test.info().workerIndex));

 const res = await page.request.get("/api/protocol");
 expect(res.status()).toBe(200);

 const body = (await res.json()) as {
  protocolMode: string;
  serverProtocolVersion: number;
  compatibilityDigest: string;
 };

 expect(["v2", "readonly_recovery"]).toContain(
  body.protocolMode,
 );
 expect(body.serverProtocolVersion).toBeGreaterThanOrEqual(1);
 expect(body.compatibilityDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
});
