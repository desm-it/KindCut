import { describe, expect, it } from "vitest";
import type { WorkspaceObject } from "./workspace-objects";
import {
  createWorkspaceGroup,
  isCompoundPathItem,
  splitCompoundPathItem,
  splitPathData,
  ungroupWorkspaceObject,
} from "./workspace-grouping";

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

  it("ungroups back to path objects restoring original names and transforms", () => {
    const objectB = { ...pathObject, id: "b", fileName: "b", transform: { x: 40, y: 15, scaleX: 1, scaleY: 1, rotation: 0 } };
    const group = createWorkspaceGroup({
      id: "group-1",
      items: [pathObject, objectB],
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
    expect(children.map((item) => item.fileName)).toEqual(["a", "b"]);
    expect(children.map((item) => item.transform)).toEqual([group.transform, group.transform]);
  });

  it("splits a compound path 'd' into its absolute subpaths", () => {
    expect(splitPathData("M0 0H10Z M20 20H30Z M40 0L45 5Z")).toEqual([
      "M0 0H10Z",
      "M20 20H30Z",
      "M40 0L45 5Z",
    ]);
    // A single subpath is not splittable.
    expect(splitPathData("M0 0H10V10H0Z").length).toBe(1);
  });

  it("recognizes a compound (multi-subpath) single-path object", () => {
    const compound = { ...pathObject, paths: [{ ...pathObject.paths[0]!, d: "M0 0H10Z M20 0H30Z" }] } as WorkspaceObject;
    expect(isCompoundPathItem(compound)).toBe(true);
    expect(isCompoundPathItem(pathObject)).toBe(false);
  });

  it("breaks a compound path into one path object per subpath, keeping colours", () => {
    const compound = {
      ...pathObject,
      shapeKind: "square" as const,
      paths: [{ id: "p", d: "M0 0H10Z M20 0H30Z M40 0H50Z", fill: "none", stroke: "#123456", strokeWidth: "2" }],
    } as WorkspaceObject;

    const parts = splitCompoundPathItem({
      item: compound,
      idPrefix: "part",
      labelForIndex: (i) => `Part ${i + 1}`,
    });

    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.paths[0]?.d)).toEqual(["M0 0H10Z", "M20 0H30Z", "M40 0H50Z"]);
    expect(parts.every((p) => p.type === "path")).toBe(true);
    expect(parts.every((p) => p.paths[0]?.stroke === "#123456")).toBe(true);
    // Split pieces are no longer the named shape.
    expect(parts.every((p) => p.shapeKind === undefined)).toBe(true);
  });
});

describe("pen fill on groups", () => {
  const fill = { enabled: true, pattern: "cross" as const, density: 30, angle: 45 };
  const member = (id: string, penFill?: typeof fill): WorkspaceObject => ({
    id,
    type: "path",
    kind: "image",
    sourceKind: "image",
    fileName: id,
    fileSize: "",
    sizeCopy: "",
    frame: { width: 10, height: 10 },
    paths: [{ id: "p", d: "M0 0H10V10H0Z", fill: "none", stroke: "#1f6feb", strokeWidth: "1" }],
    transform: { x: id === "a" ? 0 : 20, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    penFill,
  });

  it("keeps a fill every member shares and hands it back on ungroup", () => {
    const group = createWorkspaceGroup({ id: "g", items: [member("a", fill), member("b", fill)], label: "Groep", fileSize: "" });
    expect(group?.penFill).toEqual(fill);
    const parts = ungroupWorkspaceObject({ group: group!, idPrefix: "u", labelForIndex: (index) => `deel ${index}` });
    expect(parts.map((part) => part.penFill)).toEqual([fill, fill]);
  });

  it("drops the fill when members disagree", () => {
    const group = createWorkspaceGroup({ id: "g", items: [member("a", fill), member("b")], label: "Groep", fileSize: "" });
    expect(group?.penFill).toBeUndefined();
  });
});
