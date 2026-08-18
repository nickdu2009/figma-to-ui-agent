import type { Hono } from "hono";
import { CopilotRuntime } from "@copilotkit/runtime/v2";
import { createCopilotHonoHandler } from "@copilotkit/runtime/v2/hono";
import type { AbstractAgent } from "@ag-ui/client";

export const COPILOTKIT_BASE_PATH = "/api/copilotkit";

/**
 * 把 CopilotKit Runtime（多路由 REST 模式）挂载到既有 Hono app。
 * 客户端以 useSingleEndpoint={false} 访问 {basePath}/agent/:agentId/run。
 */
export function mountCopilotKitRuntime(
 app: Hono,
 agents: Record<string, AbstractAgent>,
): Hono {
 const runtime = new CopilotRuntime({ agents });
 const endpoint = createCopilotHonoHandler({
  runtime,
  basePath: COPILOTKIT_BASE_PATH,
 });
 // createCopilotHonoHandler 内部已 basePath(basePath)，这里挂到根避免双重前缀。
 app.route("/", endpoint);
 return app;
}
