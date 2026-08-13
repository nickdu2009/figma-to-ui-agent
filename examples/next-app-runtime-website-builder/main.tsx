import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { RootLayout } from "./app/layout";
import { BuilderPage } from "./app/builder/page";
import { WebsitePage } from "./app/[[...slug]]/page";
import "./app/globals.css";

document.documentElement.className = "font-geist";
document.body.className = "font-sans antialiased";
const RUNTIME_NAVIGATION_EVENT = "next-app-runtime:navigate";
const builderDescription = document.head.querySelector<HTMLMetaElement>(
  'meta[name="description"]',
);
const builderIcon = document.head.querySelector<HTMLLinkElement>(
  'link[rel="icon"]',
);

function setConnected(element: HTMLElement | null, connected: boolean) {
  if (!element) return;
  if (connected && !element.isConnected) document.head.append(element);
  if (!connected && element.isConnected) element.remove();
}

function syncStaticHead(pathname: string) {
  const builder = pathname === "/builder";
  const runtimeOwnsDescription = document.head.querySelector(
    'meta[name="description"][data-owner="next-app-runtime"]',
  ) !== null;
  const runtimeOwnsIcon = document.head.querySelector(
    'link[rel="icon"][data-owner="next-app-runtime"], ' +
      'link[rel="shortcut icon"][data-owner="next-app-runtime"], ' +
      'link[rel="apple-touch-icon"][data-owner="next-app-runtime"]',
  ) !== null;
  setConnected(builderDescription, builder || !runtimeOwnsDescription);
  setConnected(builderIcon, builder || !runtimeOwnsIcon);
}

syncStaticHead(window.location.pathname);

function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const update = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener(RUNTIME_NAVIGATION_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(RUNTIME_NAVIGATION_EVENT, update);
    };
  }, []);

  useEffect(() => {
    if (pathname === "/builder") {
      document.title = "Next Website Builder | @next-app-runtime/client";
    }
    syncStaticHead(pathname);
    const observer = new MutationObserver(() => syncStaticHead(pathname));
    observer.observe(document.head, { childList: true });
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <RootLayout>
      {pathname === "/builder" ? <BuilderPage /> : <WebsitePage />}
    </RootLayout>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
