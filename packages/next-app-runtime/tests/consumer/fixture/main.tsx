import React from "react";
import { createRoot } from "react-dom/client";
import { createNextAppRuntime, type NextAppSpec } from "@next-app-runtime/client";
import {
  NEXT_APP_SPEC_COMPATIBILITY,
  nextAppSpecSchema,
} from "@next-app-runtime/client/schema";
import { collectStaticParams } from "@next-app-runtime/client/router";
import { applyJsonPatch } from "@next-app-runtime/client/stream";

const spec: NextAppSpec = { routes: {} };
const valid = nextAppSpecSchema.safeParse(spec).success;
const params = collectStaticParams(spec).length;
const patched = applyJsonPatch({}, [{ op: "add", path: "/ok", value: true }]);

void createNextAppRuntime;

createRoot(document.getElementById("root")!).render(
  <div data-valid={valid} data-params={params} data-patched={JSON.stringify(patched)}>
    {NEXT_APP_SPEC_COMPATIBILITY}
  </div>,
);
