import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

describe("Tailwind Catalog source", () => {
  it("扫描 @json-render/shadcn 的动态 Card 宽度工具类", async () => {
    const source = await readFile("src/styles.css", "utf8");
    const result = await postcss([tailwindcss()]).process(source, {
      from: "src/styles.css",
    });

    expect(result.css).toContain(".max-w-md");
    expect(result.css).toContain(".sm\\:min-w-\\[360px\\]");
    expect(result.css).toContain(".mx-auto");
  });
});
