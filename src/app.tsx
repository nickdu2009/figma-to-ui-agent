/// <reference types="vite/client" />
import { CopilotKit } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "./chat-panel";
import { createPreviewRuntime, PreviewPanel } from "./preview-panel";
import { PublishedPreviewLoader } from "./release/published-preview-loader";
import { ReleasePanel } from "./release/release-panel";
import { BusinessDataPanel } from "./business-data/data-panel";
import { RecycleBinPanel } from "./recycle-bin/recycle-bin-panel";
import { LoginPage } from "./auth/login-page";
import { AppGate } from "./auth/app-gate";
import {
  getSession,
  listApps,
  logout,
  type AppListItem,
  type SessionUser,
} from "./auth/session-client";
import "./styles.css";

/**
 * 工作台布局（计划 §4）：左栏聊天，右栏预览。
 * 浏览器侧不包含任何 LLM 编排代码；所有工具定义与 Prompt 在 server/。
 *
 * S2：会话守卫 → 登录页 → 应用门 → 工作台。
 * 可信 appId 只由服务端经 /api/apps 授权；URL 与 localStorage 仅作
 * 刷新恢复提示（GATE-00 §4），不作为授权依据。
 */

const LAST_APP_KEY = "vma:lastAppId";

function appIdFromLocation(): string | null {
  const match = window.location.pathname.match(/^\/apps\/([^/]+)/);
  return match ? match[1] : null;
}

export function App() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [app, setApp] = useState<AppListItem | null>(null);

  useEffect(() => {
    void getSession().then(setUser);
  }, []);

  // 刷新恢复：URL 或 localStorage 提示的 appId，经服务端列表重新授权
  useEffect(() => {
    if (!user || app) return;
    const hinted = appIdFromLocation() ?? localStorage.getItem(LAST_APP_KEY);
    if (!hinted) return;
    void listApps().then((apps) => {
      const found = apps.find((a) => a.id === hinted);
      if (found) setApp(found);
    });
  }, [user, app]);

  const handleSelectApp = useCallback((selected: AppListItem) => {
    localStorage.setItem(LAST_APP_KEY, selected.id);
    window.history.pushState(null, "", `/apps/${selected.id}`);
    setApp(selected);
  }, []);

  const handleSwitchApp = useCallback(() => {
    localStorage.removeItem(LAST_APP_KEY);
    setApp(null);
    window.history.pushState(null, "", "/");
  }, []);

  const handleLogout = useCallback(() => {
    void logout().then(() => {
      localStorage.removeItem(LAST_APP_KEY);
      setApp(null);
      setUser(null);
      window.history.pushState(null, "", "/");
    });
  }, []);

  // Candidate browser benchmarks exercise the isolated in-memory Preview
  // runtime. Keep that harness independent from persisted account/app setup;
  // normal builds never receive this Vite-only flag and still require auth.
  if (import.meta.env.VITE_SPEC_BENCHMARK === "1") {
    return <PreviewPanel />;
  }

  if (user === undefined) {
    return <div data-testid="session-loading">加载中…</div>;
  }
  if (user === null) {
    return <LoginPage onLoggedIn={() => void getSession().then(setUser)} />;
  }
  if (!app) {
    return (
      <AppGate
        user={user}
        onSelectApp={handleSelectApp}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      enableInspector={false}
      properties={{ appId: app.id }}
    >
      <div data-testid="app-shell" className="app-shell">
        <header data-testid="app-context-bar" className="app-context-bar">
          <span data-testid="current-app-name">{app.name}</span>
          <button type="button" onClick={handleSwitchApp}>
            切换应用
          </button>
          <button type="button" onClick={handleLogout}>
            登出
          </button>
        </header>
        <Workbench key={app.id} app={app} onAppDeleted={handleSwitchApp} />
      </div>
    </CopilotKit>
  );
}

/**
 * 工作台（S6）：按角色呈现面板——owner 全部；editor 预览+数据；
 * viewer 仅已发布只读预览。UI 隐藏无权限操作，授权事实永远以服务端为准。
 * key={app.id} 保证切换应用后全部状态重载。
 */
function Workbench(props: { app: AppListItem; onAppDeleted: () => void }) {
  const { app, onAppDeleted } = props;
  const role = app.myRole;
  const [preview] = useState(createPreviewRuntime);
  const [tab, setTab] = useState<"data" | "release" | "bin" | null>(null);
  return (
    <>
      <PublishedPreviewLoader appId={app.id} runtime={preview.runtime} />
      <div className="app-workbench">
        {role === "owner" && (
          <ChatPanel
            agentId="chat"
            appId={app.id}
            runtime={preview.runtime}
          />
        )}
        <PreviewPanel {...preview} />
        <aside data-testid="workbench-side" className="workbench-side">
          <nav data-testid="workbench-tabs">
            {(role === "owner" || role === "editor") && (
              <button
                type="button"
                data-testid="tab-data"
                aria-pressed={tab === "data"}
                onClick={() => setTab(tab === "data" ? null : "data")}
              >
                数据
              </button>
            )}
            {role === "owner" && (
              <>
                <button
                  type="button"
                  data-testid="tab-release"
                  aria-pressed={tab === "release"}
                  onClick={() => setTab(tab === "release" ? null : "release")}
                >
                  发布
                </button>
                <button
                  type="button"
                  data-testid="tab-bin"
                  aria-pressed={tab === "bin"}
                  onClick={() => setTab(tab === "bin" ? null : "bin")}
                >
                  回收站
                </button>
              </>
            )}
          </nav>
          {tab === "data" && <BusinessDataPanel appId={app.id} role={role} />}
          {tab === "release" && role === "owner" && (
            <ReleasePanel appId={app.id} />
          )}
          {tab === "bin" && role === "owner" && (
            <RecycleBinPanel appId={app.id} onAppDeleted={onAppDeleted} />
          )}
        </aside>
      </div>
    </>
  );
}
