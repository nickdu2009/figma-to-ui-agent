import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { RootLayout } from "./app/layout";
import { BuilderPage } from "./app/builder/page";
import {
  WebsitePage,
  type WebsiteMetadataOwnership,
} from "./app/[[...slug]]/page";
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

const initialMetadataOwnership: WebsiteMetadataOwnership = {
  description: false,
  icons: false,
};

function syncStaticHead(
  pathname: string,
  ownership: WebsiteMetadataOwnership,
) {
  const builder = pathname === "/builder";
  setConnected(builderDescription, builder || !ownership.description);
  setConnected(builderIcon, builder || !ownership.icons);
}

syncStaticHead(window.location.pathname, initialMetadataOwnership);

function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [metadataOwnership, setMetadataOwnership] = useState(
    initialMetadataOwnership,
  );
  const updateMetadataOwnership = useCallback(
    (next: WebsiteMetadataOwnership) => {
      setMetadataOwnership((current) => (
        current.description === next.description && current.icons === next.icons
          ? current
          : next
      ));
    },
    [],
  );

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
    syncStaticHead(pathname, metadataOwnership);
    const observer = new MutationObserver(() => {
      syncStaticHead(pathname, metadataOwnership);
    });
    observer.observe(document.head, { childList: true });
    return () => observer.disconnect();
  }, [metadataOwnership, pathname]);

  return (
    <RootLayout>
      {pathname === "/builder"
        ? <BuilderPage />
        : <WebsitePage onMetadataOwnershipChange={updateMetadataOwnership} />}
    </RootLayout>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
