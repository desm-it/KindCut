import { describe, expect, it } from "vitest";
import type { WorkspaceItemTransform } from "./workspace-utils";
import { createPastedWorkspaceSvgInputs, getSelectedWorkspaceClipboardItems } from "./workspace-clipboard";

type TestWorkspaceItem = {
  id: string;
  fileName: string;
  fileSize: string;
  svg: string;
  transform: WorkspaceItemTransform;
};

const baseTransform: WorkspaceItemTransform = { x: 10, y: 20, scaleX: 1, scaleY: 1.5, rotation: 12 };

const baseItem: TestWorkspaceItem = {
  id: "svg-1",
  fileName: "flower.svg",
  fileSize: "1 KB",
  svg: "<svg />",
  transform: baseTransform,
};

describe("workspace clipboard", () => {
  it("copies all selected workspace images in project order", () => {
    const copied = getSelectedWorkspaceClipboardItems(
      [baseItem, { ...baseItem, id: "svg-2", fileName: "leaf.svg" }],
      ["svg-2", "svg-1"],
      null,
    );

    expect(copied).toMatchObject([{ fileName: "flower.svg" }, { fileName: "leaf.svg" }]);
    expect(copied.map((item) => item.kind)).toEqual(["image", "image"]);
    expect(copied.map((item) => item.fileName)).toEqual(["flower.svg", "leaf.svg"]);
    expect(copied.map((item) => item.transform)).toEqual([baseItem.transform, baseItem.transform]);
    expect(copied.map((item) => item.transform)).not.toContain(baseItem.transform);
  });

  it("falls back to the primary selected image when the multi-selection is empty", () => {
    const copied = getSelectedWorkspaceClipboardItems([baseItem], [], "svg-1");

    expect(copied).toMatchObject([{ fileName: "flower.svg" }]);
  });

  it("creates pasted image inputs with new ids and a visible offset", () => {
    const pasted = createPastedWorkspaceSvgInputs({
      items: [{ fileName: "flower.svg", fileSize: "1 KB", svg: "<svg />", transform: baseItem.transform }],
      startIndex: 3,
      timestamp: 12345,
    });

    expect(pasted).toEqual([
      {
        id: "svg-12345-paste-3",
        index: 3,
        kind: "image",
        shapeKind: undefined,
        fileName: "flower.svg",
        fileSize: "1 KB",
        svg: "<svg />",
        transform: { x: 34, y: 44, scaleX: 1, scaleY: 1.5, rotation: 12 },
      },
    ]);
  });
});
