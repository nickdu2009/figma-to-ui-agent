import { describe, expect, it } from "vitest";

import { assertReferences } from "../../src/validation/reference-gate.js";
import type { NextAppSpec } from "../../src/contract/types.js";

function specWithPage(
  root: string,
  elements: NextAppSpec["routes"][string]["page"]["elements"],
): NextAppSpec {
  return {
    routes: {
      "/": {
        page: { root, elements },
      },
    },
  };
}

describe("reference gate reachability", () => {
  it("allows orphaned elements and unreachable cycles", () => {
    const spec = specWithPage("root", {
      root: { type: "Text", props: { text: "Visible" } },
      orphan: {
        type: "Text",
        props: { text: "Unused" },
        children: ["orphan"],
      },
    });

    expect(() => assertReferences(spec, ["Text"], [])).not.toThrow();
  });

  it.each([
    [
      "a missing root",
      specWithPage("missing", {
        orphan: { type: "Text", props: { text: "Unused" } },
      }),
    ],
    [
      "a missing reachable child",
      specWithPage("root", {
        root: { type: "Text", props: { text: "Visible" }, children: ["missing"] },
      }),
    ],
    [
      "a reachable cycle",
      specWithPage("root", {
        root: { type: "Text", props: { text: "Visible" }, children: ["child"] },
        child: { type: "Text", props: { text: "Child" }, children: ["root"] },
      }),
    ],
  ])("still rejects %s", (_label, spec) => {
    expect(() => assertReferences(spec, ["Text"], [])).toThrowError(
      expect.objectContaining({ code: "references_invalid" }),
    );
  });

  it("does not count an orphaned Slot as a layout Slot", () => {
    const spec: NextAppSpec = {
      layouts: {
        main: {
          root: "shell",
          elements: {
            shell: { type: "Stack", props: {} },
            orphanedSlot: { type: "Slot", props: {} },
          },
        },
      },
      routes: {
        "/": {
          layout: "main",
          page: {
            root: "page",
            elements: {
              page: { type: "Text", props: { text: "Page" } },
            },
          },
        },
      },
    };

    expect(() => assertReferences(spec, ["Stack", "Text"], [])).toThrowError(
      expect.objectContaining({ code: "slot_missing" }),
    );
  });
});
