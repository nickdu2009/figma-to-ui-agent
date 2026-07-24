import { describe, expect, it } from "vitest";

import {
  FigmaInputError,
  normalizeFigmaNodeId,
  parseFigmaDesignUrl,
  resolveFigmaTargetNodes,
} from "../../../src/figma/url.ts";

const FLOW_URL =
  "https://www.figma.com/design/L8H9R9GfDn30yx5bPOmuaH/Flow-test?node-id=0-1&p=f";

describe("Figma Design URL", () => {
  it("解析正式 Design URL 并规范化 node-id", () => {
    expect(parseFigmaDesignUrl(FLOW_URL)).toEqual({
      fileKey: "L8H9R9GfDn30yx5bPOmuaH",
      nodeId: "0:1",
    });
    expect(normalizeFigmaNodeId("I12-34;56-78")).toBe(
      "I12:34;56:78",
    );
  });

  it("允许 URL 节点包含在显式目标中并去重", () => {
    const parsed = parseFigmaDesignUrl(FLOW_URL);
    expect(
      resolveFigmaTargetNodes(parsed, ["0:1", "0-1", "12:34"]),
    ).toEqual(["0:1", "12:34"]);
  });

  it("URL 节点与显式目标冲突时失败关闭", () => {
    expect(() =>
      resolveFigmaTargetNodes(parseFigmaDesignUrl(FLOW_URL), [
        "12:34",
      ]),
    ).toThrowError(
      expect.objectContaining({
        code: "conflicting_node_id",
      }),
    );
  });

  it.each([
    "http://www.figma.com/design/L8H9R9GfDn30yx5bPOmuaH/Flow-test",
    "https://api.figma.com/design/L8H9R9GfDn30yx5bPOmuaH/Flow-test",
    "https://user:secret@www.figma.com/design/L8H9R9GfDn30yx5bPOmuaH/Flow-test",
    "https://www.figma.com:444/design/L8H9R9GfDn30yx5bPOmuaH/Flow-test",
    "https://www.figma.com/file/L8H9R9GfDn30yx5bPOmuaH/Flow-test",
    "https://www.figma.com/design/short/Flow-test",
    "https://www.figma.com/design/L8H9R9GfDn30yx5bPOmuaH/Flow-test#private",
    "https://www.figma.com/design/L8H9R9GfDn30yx5bPOmuaH/Flow-test?node-id=bad",
    "https://www.figma.com/design/L8H9R9GfDn30yx5bPOmuaH/Flow-test?node-id=0-1&node-id=2-3",
  ])("拒绝非法 Figma URL：%s", (url) => {
    expect(() => parseFigmaDesignUrl(url)).toThrow(FigmaInputError);
  });
});
