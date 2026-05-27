import { describe, expect, it } from "vitest";
import { buildCutCommand, buildPlanCommand } from "./index";

describe("slicebug command builders", () => {
  it("builds a non-hardware plan command", () => {
    const command = buildPlanCommand({ slicebugExecutable: "slicebug", inputSvgPath: "in.svg", outputPlanPath: "out.json", materialId: 218, matPreset: "joy-standard", colorMap: { "000000": "pen" } });
    expect(command.sideEffect).toBe("none");
    expect(command.args).toContain("--mat-preset");
    expect(command.args).toContain("000000:pen");
  });

  it("marks cut commands as hardware side effects", () => {
    const command = buildCutCommand({ slicebugExecutable: "slicebug", planPath: "out.json", softwareButtons: true });
    expect(command.sideEffect).toBe("hardware");
    expect(command.args).toEqual(["cut", "--software-buttons", "out.json"]);
  });
});
