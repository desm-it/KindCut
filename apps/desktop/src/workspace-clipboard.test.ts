import { describe, expect, it } from "vitest";
import type { WorkspaceObject } from "./workspace-objects";
import type { WorkspaceItemTransform } from "./workspace-utils";
import { createPastedWorkspaceSvgInputs, getSelectedWorkspaceClipboardItems } from "./workspace-clipboard";

const baseTransform: WorkspaceItemTransform = { x: 10, y: 20, scaleX: 1, scaleY: 1.5, rotation: 12 };

const baseItem: WorkspaceObject = {
  id: "object-1",
  type: "path",
  kind: "image",
  sourceKind: "image",
  fileName: "flower.svg",
  fileSize: "1 KB",
  sizeCopy: "100 × 100 px",
  frame: { width: 100, height: 100 },
  paths: [{ id: "path-1", d: "M0 0L1 1", fill: "none", stroke: "#8f4f2b", strokeWidth: "2" }],
  transform: baseTransform,
};

describe("workspace clipboard", () => {
  it("copies all selected workspace objects in project order", () => {
    const copied = getSelectedWorkspaceClipboardItems(
      [baseItem, { ...baseItem, id: "object-2", fileName: "leaf.svg" }],
      ["object-2", "object-1"],
      null,
    );

    expect(copied).toMatchObject([{ fileName: "flower.svg" }, { fileName: "leaf.svg" }]);
    expect(copied.map((item) => item.kind)).toEqual(["image", "image"]);
    expect(copied.map((item) => item.type)).toEqual(["path", "path"]);
    expect(copied.map((item) => item.transform)).toEqual([baseItem.transform, baseItem.transform]);
    expect(copied.map((item) => item.transform)).not.toContain(baseItem.transform);
  });

  it("carries text content through copy and paste (so pasted text isn't empty)", () => {
    const textItem = {
      ...baseItem,
      id: "text-1",
      kind: "text",
      sourceKind: "text",
      fileName: "Happy Birthday",
      paths: [],
      textContent: {
        text: "Happy Birthday",
        fontFamily: "Caveat",
        fontSize: 48,
        fontWeight: "normal",
        fontStyle: "normal",
        textDecoration: "none",
        textAlign: "left",
        letterSpacing: 0,
        lineHeight: 1.25,
        color: "#8f4f2b",
      },
    } as unknown as WorkspaceObject;
    const copied = getSelectedWorkspaceClipboardItems([textItem], ["text-1"], null);
    expect(copied[0]?.textContent?.text).toBe("Happy Birthday");

    const pasted = createPastedWorkspaceSvgInputs({ items: copied, startIndex: 1, timestamp: 999 });
    expect(pasted[0]?.textContent?.text).toBe("Happy Birthday");
    expect(pasted[0]?.textContent).not.toBe(textItem.textContent); // cloned, not shared
  });

  it("falls back to the primary selected image when the multi-selection is empty", () => {
    const copied = getSelectedWorkspaceClipboardItems([baseItem], [], "object-1");

    expect(copied).toMatchObject([{ fileName: "flower.svg" }]);
  });

  it("creates pasted object inputs with new ids, copied paths, and a visible offset", () => {
    const pasted = createPastedWorkspaceSvgInputs({
      items: [{
        type: "group",
        kind: "image",
        sourceKind: "image",
        fileName: "flower.svg",
        fileSize: "1 KB",
        frame: baseItem.frame,
        paths: baseItem.paths,
        transform: baseItem.transform,
      }],
      startIndex: 3,
      timestamp: 12345,
    });

    expect(pasted[0]).toMatchObject({
      id: "object-12345-paste-3",
      index: 3,
      type: "group",
      kind: "image",
      fileName: "flower.svg",
      frame: { width: 100, height: 100 },
      transform: { x: 34, y: 44, scaleX: 1, scaleY: 1.5, rotation: 12 },
    });
    expect(pasted[0]?.paths[0]?.id).toContain("copy-12345");
  });
});
