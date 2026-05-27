import { describe, expect, it } from "vitest";
import {
  buildSlicebugInvocation,
  findSlicebugExecutableCandidates,
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
});
