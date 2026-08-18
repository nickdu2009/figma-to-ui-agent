import { useEffect, useState } from "react";
import {
  createApp,
  listApps,
  type AppListItem,
  type SessionUser,
} from "./session-client";

/**
 * 应用门（S2/GATE-00 §4）：应用列表、创建与选择。
 * 选择结果经 URL（/apps/:appId）与 localStorage 提示恢复；
 * 授权始终由服务端每请求重新判定。
 */
export function AppGate(props: {
  user: SessionUser;
  onSelectApp: (app: AppListItem) => void;
  onLogout: () => void;
}) {
  const [apps, setApps] = useState<AppListItem[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listApps().then(setApps);
  }, []);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await createApp(name);
    if (result.ok && result.app) {
      props.onSelectApp(result.app);
    } else {
      setError(result.message ?? "创建失败");
    }
  }

  return (
    <div data-testid="app-gate" className="app-gate">
      <header>
        <h1>我的应用</h1>
        <div>
          <span>{props.user.email}</span>
          <button type="button" onClick={props.onLogout}>
            登出
          </button>
        </div>
      </header>
      {apps === null ? (
        <p>加载中…</p>
      ) : apps.length === 0 ? (
        <p data-testid="app-list-empty">还没有应用。</p>
      ) : (
        <ul data-testid="app-list">
          {apps.map((app) => (
            <li key={app.id}>
              <button type="button" onClick={() => props.onSelectApp(app)}>
                {app.name}（{app.myRole}）
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submitCreate}>
        <label htmlFor="new-app-name">新建应用</label>
        <input
          id="new-app-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit">创建</button>
      </form>
      {error ? (
        <p data-testid="app-gate-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
