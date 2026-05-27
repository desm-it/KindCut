import { describe, expect, it } from "vitest";
import {
  MAT_PRESETS,
  MATERIAL_OPTIONS,
  buildCutCommand,
  buildPlanCommand,
  getDefaultMaterialOption,
  parseSlicebugAction,
} from "./index";

describe("slicebug command builders", () => {
  it("builds a non-hardware plan command", () => {
    const command = buildPlanCommand({ slicebugExecutable: "slicebug", inputSvgPath: "in.svg", outputPlanPath: "out.json", materialId: 218, matPreset: "joy-standard", colorMap: { "000000": "pen" } });
    expect(command.sideEffect).toBe("none");
    expect(command.args).toContain("--mat-preset");
    expect(command.args).toContain("000000:pen");
  });

  it("marks cut commands as hardware side effects", () => {
    const command = buildCutCommand({ slicebugExecutable: "slicebug", planPath: "out.json", machine: "cricut_joy" });
    expect(command.sideEffect).toBe("hardware");
    expect(command.args).toEqual(["cut", "--software-buttons", "out.json"]);
  });

  it("exposes a small curated material list with SliceBug IDs", () => {
    expect(MATERIAL_OPTIONS.map((material) => [material.id, material.name])).toEqual([
      [218, "Light Cardstock"],
      [19, "Medium Cardstock"],
      [211, "Heavy Cardstock"],
      [535, "Insert Card"],
      [20, "Vinyl"],
    ]);
    expect(getDefaultMaterialOption().id).toBe(218);
  });

  it("exposes Cricut Joy mat presets with friendly labels", () => {
    expect(MAT_PRESETS.map((mat) => mat.id)).toEqual(["joy-standard", "joy-standard-short", "joy-card"]);
    expect(MAT_PRESETS.find((mat) => mat.id === "joy-card")?.name).toBe("Joy card mat");
  });

  it("parses common SliceBug prompts into friendly action states", () => {
    expect(parseSlicebugAction("Load black pen into clamp A, then press enter").kind).toBe("load-tools");
    expect(parseSlicebugAction("Insert/load mat and press Enter when ready").kind).toBe("load-mat");
    expect(parseSlicebugAction("Press Go / start on the cutter").kind).toBe("press-go");
    expect(parseSlicebugAction("Replace tool with fine point blade").kind).toBe("replace-tool");
    expect(parseSlicebugAction("Cutting path 4 of 10").kind).toBe("running");
    expect(parseSlicebugAction("Finished. Unload the mat.").kind).toBe("finished");
    expect(parseSlicebugAction("ERROR: USB connection failed").kind).toBe("error");
  });

  it("marks prompt action states as waiting for a clear user continue", () => {
    expect(parseSlicebugAction("Press Enter to continue after loading mat")).toMatchObject({
      kind: "load-mat",
      requiresContinue: true,
    });
    expect(parseSlicebugAction("Cutting now")).toMatchObject({ kind: "running", requiresContinue: false });
  });
});
