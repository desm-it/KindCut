import { describe, expect, it } from "vitest";
import {
  buildSamplePlanRequest,
  buildSlicebugInvocation,
  findSlicebugExecutableCandidates,
  summarizePlanResult,
  summarizeSlicebugResult,
} from "./slicebug-service";

describe("slicebug desktop service", () => {
  it("prefers Joel's local SliceBug venv before PATH", () => {
    expect(findSlicebugExecutableCandidates()).toEqual([
      "/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug",
      "slicebug",
    ]);
  });

  it("builds only the safe non-cutting status invocation", () => {
    expect(buildSlicebugInvocation()).toEqual({ args: ["--version"] });
  });

  it("summarizes a successful SliceBug response", () => {
    expect(
      summarizeSlicebugResult({
        executable: "/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug",
        stdout: "0.2\n",
        stderr: "",
      }),
    ).toEqual({
      ok: true,
      executable: "/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug",
      version: "0.2",
      message: "SliceBug 0.2 is available.",
    });
  });

  it("keeps stderr visible when SliceBug fails", () => {
    expect(
      summarizeSlicebugResult({
        executable: "slicebug",
        stdout: "",
        stderr: "not found",
        error: "exit 127",
      }),
    ).toEqual({
      ok: false,
      executable: "slicebug",
      version: null,
      message: "exit 127\nnot found",
    });
  });

  it("builds a safe non-cutting sample plan request", () => {
    const request = buildSamplePlanRequest("/tmp/cricut-companion-plan");

    expect(request.inputSvgPath).toBe("/tmp/cricut-companion-plan/sample-card.svg");
    expect(request.outputPlanPath).toBe("/tmp/cricut-companion-plan/sample-card.json");
    expect(request.svg).toContain("stroke=\"#ff0000\"");
    expect(request.invocation).toEqual({
      args: [
        "plan",
        "/tmp/cricut-companion-plan/sample-card.svg",
        "/tmp/cricut-companion-plan/sample-card.json",
        "--material",
        "218",
        "--mat-preset",
        "joy-standard",
        "--map",
        "000000:pen",
        "--map",
        "ff0000:fine_point_blade",
      ],
    });
  });

  it("summarizes successful plan generation with parsed plan metadata", () => {
    expect(
      summarizePlanResult({
        executable: "/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug",
        stdout: "Dimensions are 3.0 x 2.5 in\nFound 2 paths\n",
        stderr: "",
        inputSvgPath: "/tmp/sample-card.svg",
        outputPlanPath: "/tmp/sample-card.json",
        planJson: JSON.stringify({
          mat: { width: 4.5, height: 12 },
          material: { width: 3, height: 2.5, type: 218 },
          paths: [{ tool: "fine_point_blade" }, { tool: "pen" }],
        }),
      }),
    ).toEqual({
      ok: true,
      executable: "/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug",
      inputSvgPath: "/tmp/sample-card.svg",
      outputPlanPath: "/tmp/sample-card.json",
      stdout: "Dimensions are 3.0 x 2.5 in\nFound 2 paths\n",
      stderr: "",
      message: "Generated SliceBug plan with 2 paths for 3×2.5 in material on a 4.5×12 in mat.",
      plan: {
        mat: { width: 4.5, height: 12 },
        material: { width: 3, height: 2.5, type: 218 },
        pathCount: 2,
        tools: ["fine_point_blade", "pen"],
      },
    });
  });

  it("summarizes failed plan generation without hiding stdout or stderr", () => {
    expect(
      summarizePlanResult({
        executable: "slicebug",
        stdout: "Dimensions are 5 x 5 in",
        stderr: "too wide",
        error: "exit 1",
        inputSvgPath: "/tmp/bad.svg",
        outputPlanPath: "/tmp/bad.json",
      }),
    ).toMatchObject({
      ok: false,
      executable: "slicebug",
      inputSvgPath: "/tmp/bad.svg",
      outputPlanPath: "/tmp/bad.json",
      stdout: "Dimensions are 5 x 5 in",
      stderr: "too wide",
      message: "exit 1\ntoo wide",
      plan: null,
    });
  });
});
