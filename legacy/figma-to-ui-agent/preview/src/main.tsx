import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { PreviewApp } from "./preview-app.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Preview 根节点不存在");
}

createRoot(root).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
