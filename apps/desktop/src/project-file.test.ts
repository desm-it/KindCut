import { describe, expect, it } from "vitest";

import {
  DEFAULT_BEHIND_COLOR,
  DEFAULT_PAPER_COLOR,
  PEN_PALETTE,
  buildProjectFile,
  getBehindColor,
  getPens,
  nextPenColor,
  parseProjectFile,
  serializeProjectFile,
  withBehindColor,
  withPens,
} from "./project-file";

describe("nextPenColor", () => {
  it("returns the first palette colour when nothing is used", () => {
    expect(nextPenColor([])).toBe(PEN_PALETTE[0]);
  });

  it("skips colours already in use (case-insensitive) and returns the next free one", () => {
    expect(nextPenColor([PEN_PALETTE[0]!.toUpperCase()])).toBe(PEN_PALETTE[1]);
    expect(nextPenColor([PEN_PALETTE[0]!, PEN_PALETTE[1]!])).toBe(PEN_PALETTE[2]);
  });

  it("never returns a colour that is already used by a pen, paper, or behind", () => {
    const used = [PEN_PALETTE[0]!, "#fffdf9", DEFAULT_BEHIND_COLOR];
    expect(used.map((c) => c.toLowerCase())).not.toContain(nextPenColor(used).toLowerCase());
  });
});

describe("workspace tool helpers (one cut + N pens)", () => {
  const tools = [
    { id: "pen-1", color: "#000000", type: "pen" as const },
    { id: "pen-2", color: "#1d4ed8", type: "pen" as const },
    { id: "cut-1", color: "#e23b3b", type: "cut" as const },
  ];

  it("getPens returns only pens; getBehindColor returns the cut tool colour", () => {
    expect(getPens(tools).map((t) => t.id)).toEqual(["pen-1", "pen-2"]);
    expect(getBehindColor(tools)).toBe("#e23b3b");
  });

  it("withBehindColor replaces the cut colour and keeps exactly one cut tool", () => {
    const next = withBehindColor(tools, "#00ff00");
    expect(getBehindColor(next)).toBe("#00ff00");
    expect(next.filter((t) => t.type === "cut")).toHaveLength(1);
    expect(getPens(next)).toHaveLength(2);
  });

  it("withPens replaces the pen list and keeps the single cut tool", () => {
    const next = withPens(tools, [{ id: "pen-x", color: "#abcdef", type: "pen" }]);
    expect(getPens(next).map((t) => t.color)).toEqual(["#abcdef"]);
    expect(next.filter((t) => t.type === "cut")).toHaveLength(1);
    expect(getBehindColor(next)).toBe("#e23b3b");
  });
});

describe("KindCut project files", () => {
  it("serializes a blank workspace with material, mat, and measurement choices", () => {
    const project = buildProjectFile({
      name: "Nieuw leeg ontwerp",
      selectedMaterialId: 218,
      selectedMatPreset: "joy-standard",
      measurementUnit: "cm",
      importedSvg: null,
    });

    expect(project).toMatchObject({
      format: "kindcut-project",
      version: 1,
      name: "Nieuw leeg ontwerp",
      workspace: {
        selectedMaterialId: 218,
        selectedMatPreset: "joy-standard",
        measurementUnit: "cm",
      },
      importedSvgs: [],
      selectedSvgId: null,
      importedSvg: null,
    });
    expect(JSON.parse(serializeProjectFile(project))).toMatchObject(project);
  });

  it("round-trips an imported image project with full transforms and no temporary SliceBug plan paths", () => {
    const saved = serializeProjectFile(
      buildProjectFile({
        name: "card.svg",
        selectedMaterialId: 20,
        selectedMatPreset: "joy-standard-short",
        measurementUnit: "in",
        importedSvgs: [{
          id: "svg-card",
          kind: "image",
          fileName: "card.svg",
          fileSize: "512 B",
          svg: '<svg width="10" height="20"><path d="M0 0L1 1" /></svg>',
          transform: { x: -24, y: 936, scaleX: 1.2, scaleY: 0.75, rotation: 32 },
        }],
        selectedSvgId: "svg-card",
      }),
    );

    const parsed = parseProjectFile(saved);

    expect(parsed.importedSvgs).toEqual([{
      id: "svg-card",
      kind: "image",
      shapeKind: undefined,
      fileName: "card.svg",
      fileSize: "512 B",
      svg: '<svg width="10" height="20"><path d="M0 0L1 1" /></svg>',
      transform: { x: -24, y: 936, scaleX: 1.2, scaleY: 0.75, rotation: 32, mirrorX: false, mirrorY: false },
    }]);
    expect(parsed.importedSvg).toEqual(parsed.importedSvgs[0]);
    expect(parsed.selectedSvgId).toBe("svg-card");
    expect(JSON.stringify(parsed)).not.toContain("outputPlanPath");
  });

  it("opens legacy single-scale transforms as uniform unrotated image transforms", () => {
    const parsed = parseProjectFile(
      JSON.stringify({
        format: "kindcut-project",
        version: 1,
        name: "legacy transform",
        savedAt: "2026-01-01T00:00:00.000Z",
        workspace: {
          selectedMaterialId: 20,
          selectedMatPreset: "joy-standard",
          measurementUnit: "cm",
        },
        importedSvgs: [
          {
            id: "svg-1",
            fileName: "legacy.svg",
            fileSize: "1 KB",
            svg: "<svg />",
            transform: { x: -40, y: 920, scale: 1.4 },
          },
        ],
      }),
    );

    expect(parsed.importedSvgs[0]?.transform).toEqual({ x: -40, y: 920, scaleX: 1.4, scaleY: 1.4, rotation: 0, mirrorX: false, mirrorY: false });
    expect(parsed.importedSvgs[0]?.kind).toBe("image");
  });

  it("round-trips a built-in shape with its friendly shape metadata", () => {
    const saved = serializeProjectFile(
      buildProjectFile({
        name: "vormen",
        selectedMaterialId: 218,
        selectedMatPreset: "joy-standard",
        measurementUnit: "cm",
        importedSvgs: [{
          id: "shape-1",
          kind: "shape",
          shapeKind: "rounded-square",
          fileName: "Afgerond vierkant",
          fileSize: "KindCut-vorm",
          svg: '<svg width="2in" height="2in"><path d="M 0 0 H 10" /></svg>',
          transform: { x: 12, y: 24, scaleX: 1.5, scaleY: 1.5, rotation: 45 },
        }],
        selectedSvgId: "shape-1",
      }),
    );

    const parsed = parseProjectFile(saved);

    expect(parsed.importedSvgs[0]).toMatchObject({
      id: "shape-1",
      kind: "shape",
      shapeKind: "rounded-square",
      fileName: "Afgerond vierkant",
      fileSize: "KindCut-vorm",
      transform: { x: 12, y: 24, scaleX: 1.5, scaleY: 1.5, rotation: 45 },
    });
    expect(parsed.selectedSvgId).toBe("shape-1");
  });

  it("saves and loads one path workspace object", () => {
    const saved = serializeProjectFile(
      buildProjectFile({
        name: "pad",
        selectedMaterialId: 218,
        selectedMatPreset: "joy-standard",
        measurementUnit: "cm",
        workspaceObjects: [{
          id: "object-1",
          type: "path",
          kind: "image",
          sourceKind: "image",
          fileName: "bloem.svg",
          fileSize: "1 KB",
          frame: { width: 100, height: 80 },
          paths: [{ id: "path-1", d: "M0 0H10", fill: "none", stroke: "#8f4f2b", strokeWidth: "2" }],
          transform: { x: 1, y: 2, scaleX: 1, scaleY: 1, rotation: 0 },
        }],
        selectedObjectId: "object-1",
      }),
    );

    const parsed = parseProjectFile(saved);

    expect(parsed.workspaceObjects).toEqual([{
      id: "object-1",
      type: "path",
      kind: "image",
      sourceKind: "image",
      shapeKind: undefined,
      fileName: "bloem.svg",
      fileSize: "1 KB",
      frame: { width: 100, height: 80 },
      paths: [{ id: "path-1", d: "M0 0H10", fill: "none", stroke: "#8f4f2b", strokeWidth: "2", strokeLinecap: undefined, strokeLinejoin: undefined, fillRule: undefined, pathTransform: undefined, sourceLabel: undefined }],
      transform: { x: 1, y: 2, scaleX: 1, scaleY: 1, rotation: 0, mirrorX: false, mirrorY: false },
      textContent: undefined,
    }]);
    expect(parsed.selectedObjectId).toBe("object-1");
  });

  it("saves and loads a grouped workspace object", () => {
    const parsed = parseProjectFile(serializeProjectFile(buildProjectFile({
      name: "groep",
      selectedMaterialId: 218,
      selectedMatPreset: "joy-standard",
      measurementUnit: "cm",
      workspaceObjects: [{
        id: "group-1",
        type: "group",
        kind: "image",
        sourceKind: "image",
        fileName: "Groep",
        fileSize: "2 onderdelen",
        frame: { width: 100, height: 100 },
        paths: [
          { id: "path-1", d: "M0 0H10", fill: "none", stroke: "#8f4f2b", strokeWidth: "2" },
          { id: "path-2", d: "M0 10H10", fill: "none", stroke: "#8f4f2b", strokeWidth: "2" },
        ],
        transform: { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0 },
      }],
      selectedObjectId: "group-1",
    })));

    expect(parsed.workspaceObjects[0]?.type).toBe("group");
    expect(parsed.workspaceObjects[0]?.paths).toHaveLength(2);
    expect(parsed.selectedObjectId).toBe("group-1");
  });

  it("migrates old imported SVG records into path workspace objects", () => {
    const parsed = parseProjectFile(JSON.stringify({
      format: "kindcut-project",
      version: 1,
      name: "legacy",
      savedAt: "2026-01-01T00:00:00.000Z",
      workspace: { selectedMaterialId: 20, selectedMatPreset: "joy-standard", measurementUnit: "cm" },
      importedSvgs: [{
        id: "svg-1",
        fileName: "legacy.svg",
        fileSize: "1 KB",
        svg: '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/><path d="M0 0H10"/></svg>',
      }],
      selectedSvgId: "svg-1",
    }));

    expect(parsed.workspaceObjects[0]).toMatchObject({
      id: "svg-1",
      type: "path",
      fileName: "legacy.svg",
      paths: [{ d: "M0 0H10" }],
    });
    expect(parsed.selectedObjectId).toBe("svg-1");
  });

  it("opens legacy single-SVG project files as a one-item workspace", () => {
    const parsed = parseProjectFile(
      JSON.stringify({
        format: "kindcut-project",
        version: 1,
        name: "legacy",
        savedAt: "2026-01-01T00:00:00.000Z",
        workspace: {
          selectedMaterialId: 20,
          selectedMatPreset: "joy-standard",
          measurementUnit: "cm",
        },
        importedSvg: {
          fileName: "legacy.svg",
          fileSize: "1 KB",
          svg: "<svg />",
        },
      }),
    );

    expect(parsed.importedSvgs).toEqual([
      {
        id: "svg-1",
        kind: "image",
        shapeKind: undefined,
        fileName: "legacy.svg",
        fileSize: "1 KB",
        svg: "<svg />",
        transform: undefined,
      },
    ]);
    expect(parsed.selectedSvgId).toBe("svg-1");
  });

  it("defaults a blank project to one pen + one cut tool and a white paper colour", () => {
    const project = buildProjectFile({
      name: "blank",
      selectedMaterialId: 218,
      selectedMatPreset: "joy-standard",
      measurementUnit: "cm",
    });
    expect(getPens(project.workspace.tools)).toHaveLength(1);
    expect(project.workspace.tools.filter((t) => t.type === "cut")).toHaveLength(1);
    expect(getBehindColor(project.workspace.tools)).toBe(DEFAULT_BEHIND_COLOR);
    expect(project.workspace.paperColor).toBe(DEFAULT_PAPER_COLOR);
  });

  it("migrates a legacy project with two cut tools down to a single cut tool + a pen, and defaults paper colour", () => {
    const parsed = parseProjectFile(JSON.stringify({
      format: "kindcut-project",
      version: 1,
      name: "legacy tools",
      savedAt: "2026-01-01T00:00:00.000Z",
      workspace: {
        selectedMaterialId: 20,
        selectedMatPreset: "joy-standard",
        measurementUnit: "cm",
        tools: [
          { id: "tool-1", color: "#000000", type: "cut" },
          { id: "tool-2", color: "#ff0000", type: "cut" },
        ],
      },
    }));
    const cuts = parsed.workspace.tools.filter((t) => t.type === "cut");
    expect(cuts).toHaveLength(1);
    expect(cuts[0]?.color).toBe("#000000"); // first cut colour wins
    expect(getPens(parsed.workspace.tools).length).toBeGreaterThanOrEqual(1);
    expect(parsed.workspace.paperColor).toBe(DEFAULT_PAPER_COLOR);
  });

  it("round-trips pens, behind colour, and paper colour through save/load", () => {
    const saved = serializeProjectFile(buildProjectFile({
      name: "colors",
      selectedMaterialId: 218,
      selectedMatPreset: "joy-standard",
      measurementUnit: "cm",
      tools: [
        { id: "pen-1", color: "#222222", type: "pen" },
        { id: "cut-1", color: "#00a000", type: "cut" },
      ],
      paperColor: "#fef0c0",
    }));
    const parsed = parseProjectFile(saved);
    expect(getBehindColor(parsed.workspace.tools)).toBe("#00a000");
    expect(getPens(parsed.workspace.tools).map((t) => t.color)).toEqual(["#222222"]);
    expect(parsed.workspace.paperColor).toBe("#fef0c0");
  });

  it("rejects unsupported or malformed project files", () => {
    expect(() => parseProjectFile("not json")).toThrow("not a valid KindCut project");
    expect(() => parseProjectFile(JSON.stringify({ format: "kindcut-project", version: 99 }))).toThrow(
      "unsupported KindCut project version",
    );
    expect(() => parseProjectFile(JSON.stringify({ format: "other", version: 1 }))).toThrow(
      "not a valid KindCut project",
    );
    expect(() => parseProjectFile(JSON.stringify({
      format: "kindcut-project",
      version: 1,
      name: "bad object",
      savedAt: "2026-01-01T00:00:00.000Z",
      workspace: { selectedMaterialId: 20, selectedMatPreset: "joy-standard", measurementUnit: "cm" },
      workspaceObjects: [{ id: "bad", type: "path", fileName: "bad", fileSize: "1 KB", frame: { width: 1, height: 1 }, paths: [] }],
    }))).toThrow("not a valid KindCut project");
  });
});
