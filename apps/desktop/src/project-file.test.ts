import { describe, expect, it } from "vitest";

import { buildProjectFile, parseProjectFile, serializeProjectFile } from "./project-file";

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
      transform: { x: -24, y: 936, scaleX: 1.2, scaleY: 0.75, rotation: 32 },
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

    expect(parsed.importedSvgs[0]?.transform).toEqual({ x: -40, y: 920, scaleX: 1.4, scaleY: 1.4, rotation: 0 });
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

  it("rejects unsupported or malformed project files", () => {
    expect(() => parseProjectFile("not json")).toThrow("not a valid KindCut project");
    expect(() => parseProjectFile(JSON.stringify({ format: "kindcut-project", version: 99 }))).toThrow(
      "unsupported KindCut project version",
    );
    expect(() => parseProjectFile(JSON.stringify({ format: "other", version: 1 }))).toThrow(
      "not a valid KindCut project",
    );
  });
});
