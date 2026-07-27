import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { CatalogApp } from "./catalog-app.tsx";
import "../../preview/src/styles.css";
import "./catalog.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Catalog 根节点不存在");
}

createRoot(root).render(
  <StrictMode>
    <CatalogApp />
  </StrictMode>,
);
