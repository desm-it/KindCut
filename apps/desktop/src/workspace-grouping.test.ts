import { describe, expect, it } from "vitest";
import type { WorkspaceObject } from "./workspace-objects";
import { createWorkspaceGroup, ungroupWorkspaceObject } from "./workspace-grouping";

const pathObject: WorkspaceObject = {
  id: "a",
  type: "path",
  kind: "image",
  sourceKind: "image",
  fileName: "a",
  fileSize: "1 KB",
  sizeCopy: "20 × 20 px",
  frame: { width: 20, height: 20 },
  paths: [{ id: "path-1", d: "M0 0H20", fill: "none", stroke: "#8f4f2b", strokeWidth: "2" }],
  transform: { x: 10, y: 15, scaleX: 1, scaleY: 1, rotation: 0 },
};

describe("workspace grouping", () => {
  it("groups selected top-level objects into one object with relative path transforms", () => {
    const group = createWorkspaceGroup({
      id: "group-1",
      items: [pathObject, { ...pathObject, id: "b", transform: { x: 40, y: 55, scaleX: 2, scaleY: 2, rotation: 15 } }],
      label: "Groep",
      fileSize: "2 onderdelen",
    });

    expect(group).toMatchObject({
      id: "group-1",
      type: "group",
      transform: { x: 10, y: 15, scaleX: 1, scaleY: 1, rotation: 0 },
    });
    expect(group?.frame.width).toBeCloseTo(68.64);
    expect(group?.frame.height).toBeCloseTo(88.99);
    expect(group?.paths).toHaveLength(2);
    expect(group?.paths[1]?.pathTransform).toContain("translate(30 40)");
  });

  it("ungroups back to path objects without changing the group transform", () => {
    const group = createWorkspaceGroup({
      id: "group-1",
      items: [pathObject, { ...pathObject, id: "b", transform: { x: 40, y: 15, scaleX: 1, scaleY: 1, rotation: 0 } }],
      label: "Groep",
      fileSize: "2 onderdelen",
    })!;

    const children = ungroupWorkspaceObject({
      group,
      idPrefix: "part",
      labelForIndex: (index) => `Onderdeel ${index + 1}`,
    });

    expect(children).toHaveLength(2);
    expect(children.every((item) => item.type === "path")).toBe(true);
    expect(children.map((item) => item.transform)).toEqual([group.transform, group.transform]);
  });
});
