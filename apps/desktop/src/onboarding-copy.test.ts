import { describe, expect, it } from "vitest";
import {
  APP_NAME,
  formatToolName,
  getFriendlyPlanResultCopy,
  getFriendlySlicebugStatusCopy,
} from "./onboarding-copy";

describe("onboarding copy", () => {
  it("uses the safer working name", () => {
    expect(APP_NAME).toBe("KindCut");
  });

  it("keeps a successful cutter-helper check friendly", () => {
    const copy = getFriendlySlicebugStatusCopy(
      {
        ok: true,
        executable: "/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug",
        version: "0.2",
        message: "SliceBug 0.2 is available.",
      },
      false,
    );

    expect(copy.tone).toBe("ready");
    expect(copy.message).not.toMatch(/executable|PATH|slicebug --version|stdout|stderr|JSON/i);
    expect(copy.details.join("\n")).toContain("Executable:");
  });

  it("keeps missing-helper wording calm and hides technical detail", () => {
    const copy = getFriendlySlicebugStatusCopy(
      {
        ok: false,
        executable: null,
        version: null,
        message: "SliceBug was not found. Expected /some/path or slicebug on PATH.",
      },
      false,
    );

    expect(copy.tone).toBe("warning");
    expect(copy.title).toBe("One helper needs attention");
    expect(copy.message).not.toMatch(/executable|PATH|slicebug --version|stdout|stderr|JSON/i);
    expect(copy.details.join("\n")).toMatch(/PATH/);
  });

  it("summarizes sample plan results without raw output words in primary copy", () => {
    const copy = getFriendlyPlanResultCopy({
      ok: true,
      executable: "slicebug",
      inputSvgPath: "/tmp/sample.svg",
      outputPlanPath: "/tmp/sample.json",
      stdout: "Found 2 paths",
      stderr: "",
      message: "Generated SliceBug plan with 2 paths.",
      plan: {
        mat: { width: 4.5, height: 12 },
        material: { width: 3, height: 2.5, type: 218 },
        pathCount: 2,
        tools: ["fine_point_blade", "pen"],
      },
    });

    expect(copy.tone).toBe("ready");
    expect(copy.message).toContain("2 layers");
    expect(copy.message).not.toMatch(/executable|PATH|slicebug --version|stdout|stderr|JSON/i);
    expect(copy.details.join("\n")).toMatch(/stdout/);
  });

  it("turns tool ids into crafter-friendly labels", () => {
    expect(formatToolName("fine_point_blade")).toBe("Fine-point blade");
    expect(formatToolName("foil_transfer")).toBe("Foil Transfer");
  });
});
