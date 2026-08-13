import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { RootLayout } from "./app/layout";
import { BuilderPage } from "./app/builder/page";
import { WebsitePage } from "./app/[[...slug]]/page";
import "./app/globals.css";

document.documentElement.className = "font-geist";
document.body.className = "font-sans antialiased";
const RUNTIME_NAVIGATION_EVENT = "next-app-runtime:navigate";

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
  }, [pathname]);

  return (
    <RootLayout>
      {pathname === "/builder" ? <BuilderPage /> : <WebsitePage />}
    </RootLayout>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
