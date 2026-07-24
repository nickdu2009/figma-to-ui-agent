import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ProjectStore } from "../../src/project-store/store.ts";

const execFileAsync = promisify(execFile);

export default async function globalSetup(): Promise<void> {
  await execFileAsync(process.execPath, ["scripts/probe-m2.mjs"], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 2 * 1024 * 1024,
  });

  const store = new ProjectStore("data");
  const current = await store.loadUISpec("m2-preview");
  const { revision: _revision, ...draft } =
    structuredClone(current);
  const title = draft.nodes.find((node) => node.id === "title");
  if (title?.kind === "text") {
    title.text = "设计预览（当前修订）";
  }
  for (const node of draft.nodes) {
    if (
      ["continue", "email", "terms"].includes(node.id) &&
      (node.kind === "button" ||
        node.kind === "input" ||
        node.kind === "checkbox")
    ) {
      node.disabled = true;
    }
  }
  await store.saveUISpec({
    projectId: "m2-preview",
    baseRevision: 1,
    draft,
  });
}
