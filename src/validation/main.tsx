/**
 * __validation 页面入口（设计 §11.5，计划 S9 动作 2）。
 *
 * 独立 Vite 多页入口：不导入/挂载 BrowserShell、主 App、聊天或正常
 * Preview。只渲染 Validation worker 经 addInitScript 注入的单个
 * Candidate case（route × viewport）；不持有 capability、不发起
 * 用户 Session 请求、不调用真实业务 Action（fixture adapter，见
 * validation-app.tsx）。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ValidationApp } from "./validation-app.tsx";
import "../styles.css";

declare global {
  interface Window {
    __VALIDATION_BOOTSTRAP__?: unknown;
    __VALIDATION_RENDERED__?: string;
  }
}

function setRenderedFlag(flag: string): void {
  window.__VALIDATION_RENDERED__ = flag;
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  setRenderedFlag("failed:no-root");
} else if (window.__VALIDATION_BOOTSTRAP__) {
  setRenderedFlag("rendering");
  createRoot(rootElement).render(
    <StrictMode>
      <ValidationApp
        bootstrap={window.__VALIDATION_BOOTSTRAP__}
        onRendered={setRenderedFlag}
      />
    </StrictMode>,
  );
} else {
  // 页面只接受 worker 注入的 bootstrap；直接访问不渲染任何内容
  setRenderedFlag("failed:no-bootstrap");
}
