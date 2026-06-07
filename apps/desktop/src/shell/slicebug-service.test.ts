import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SlicebugCutSession,
  buildBootstrapInvocation,
  buildSamplePlanRequest,
  buildSlicebugSubprocessEnv,
  buildSvgPlanRequest,
  buildSlicebugInvocation,
  bundledSlicebugExecutablePath,
  bundledUsvgExecutablePath,
  defaultDesignSpacePaths,
  desktopResourceSlicebugExecutablePath,
  desktopResourceUsvgExecutablePath,
  findBundledUsvgCandidates,
  findSlicebugExecutableCandidates,
  getSlicebugSetupStatus,
  isBundledUsvgBootstrapFallback,
  summarizePlanResult,
  summarizeSlicebugResult,
  vendoredSlicebugFrozenExecutablePath,
  vendoredSlicebugVenvExecutablePath,
} from "./slicebug-service";

describe("slicebug desktop service", () => {
  it("looks for packaged and local bundled SliceBug before dev fallbacks", () => {
    expect(
      findSlicebugExecutableCandidates({
        platform: "darwin",
        resourcesPath: "/Applications/KindCut.app/Contents/Resources",
        appRoot: "/repo/apps/desktop",
        repoRoot: "/repo",
        envExecutable: "/custom/slicebug",
      }),
    ).toEqual([
      "/custom/slicebug",
      "/Applications/KindCut.app/Contents/Resources/slicebug/slicebug",
      "/repo/apps/desktop/resources/slicebug/slicebug",
      "/repo/vendor/slicebug/.venv/bin/slicebug",
      "/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug",
      "slicebug",
    ]);
  });

  it("builds platform-specific bundled SliceBug and usvg paths", () => {
    expect(bundledSlicebugExecutablePath("/resources", "darwin")).toBe("/resources/slicebug/slicebug");
    expect(bundledUsvgExecutablePath("/resources", "darwin")).toBe("/resources/slicebug/plugins/usvg/usvg");
    expect(bundledSlicebugExecutablePath("C:\\KindCut\\resources", "win32")).toBe(
      path.join("C:\\KindCut\\resources", "slicebug", "slicebug.exe"),
    );
    expect(bundledUsvgExecutablePath("C:\\KindCut\\resources", "win32")).toBe(
      path.join("C:\\KindCut\\resources", "slicebug", "plugins", "usvg", "usvg.exe"),
    );
    expect(desktopResourceSlicebugExecutablePath("/repo/apps/desktop", "darwin")).toBe(
      "/repo/apps/desktop/resources/slicebug/slicebug",
    );
    expect(desktopResourceUsvgExecutablePath("/repo/apps/desktop", "darwin")).toBe(
      "/repo/apps/desktop/resources/slicebug/plugins/usvg/usvg",
    );
    expect(vendoredSlicebugFrozenExecutablePath("/repo", "win32")).toBe(
      path.join("/repo", "apps", "desktop", "resources", "slicebug", "slicebug.exe"),
    );
    expect(vendoredSlicebugVenvExecutablePath("/repo", "win32")).toBe(
      path.join("/repo", "vendor", "slicebug", ".venv", "Scripts", "slicebug.exe"),
    );
  });

  it("finds bundled usvg candidates and prepends their directory to PATH", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kindcut-usvg-path-"));
    const resources = path.join(root, "resources");
    const usvg = path.join(resources, "slicebug", "plugins", "usvg", "usvg");
    fs.mkdirSync(path.dirname(usvg), { recursive: true });
    fs.writeFileSync(usvg, "");

    expect(findBundledUsvgCandidates({ platform: "darwin", resourcesPath: resources, appRoot: "/missing/app", repoRoot: "/missing/repo" })).toEqual([
      usvg,
      "/missing/app/resources/slicebug/plugins/usvg/usvg",
      "/missing/repo/apps/desktop/resources/slicebug/plugins/usvg/usvg",
    ]);

    const env = buildSlicebugSubprocessEnv({
      platform: "darwin",
      resourcesPath: resources,
      appRoot: "/missing/app",
      repoRoot: "/missing/repo",
    });
    expect(env.PATH?.split(path.delimiter)[0]).toBe(path.dirname(usvg));
  });

  it("builds only the safe non-cutting status invocation", () => {
    expect(buildSlicebugInvocation()).toEqual({ args: ["--version"] });
  });

  it("builds an explicit first-run bootstrap invocation", () => {
    expect(
      buildBootstrapInvocation({
        designSpacePath: "/Applications/Cricut Design Space.app/Contents/Resources",
        designSpaceProfilePath: "/Users/test/.cricut-design-space",
      }),
    ).toEqual({
      args: [
        "bootstrap",
        "--design-space-path",
        "/Applications/Cricut Design Space.app/Contents/Resources",
        "--design-space-profile-path",
        "/Users/test/.cricut-design-space",
      ],
    });
  });

  it("knows Cricut Design Space default paths on macOS and Windows", () => {
    expect(defaultDesignSpacePaths("darwin", "/Users/test")).toEqual({
      designSpacePath: "/Applications/Cricut Design Space.app/Contents/Resources",
      designSpaceProfilePath: "/Users/test/.cricut-design-space",
    });
    expect(defaultDesignSpacePaths("win32", "C:\\Users\\Test")).toEqual({
      designSpacePath: path.join("C:\\Users\\Test", "AppData", "Local", "Programs", "Cricut Design Space"),
      designSpaceProfilePath: path.join("C:\\Users\\Test", ".cricut-design-space"),
    });
  });

  it("detects whether SliceBug has been bootstrapped without touching hardware", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kindcut-slicebug-setup-"));
    const config = path.join(home, ".slicebug");
    fs.mkdirSync(path.join(config, "plugins", "device-common"), { recursive: true });
    fs.mkdirSync(path.join(config, "plugins", "usvg"), { recursive: true });

    expect(getSlicebugSetupStatus(home, "darwin", null)).toMatchObject({
      hasKeys: false,
      hasProfiles: false,
      hasDevicePlugin: false,
      hasUsvg: false,
      bootstrapped: false,
    });

    fs.writeFileSync(path.join(config, "keys.json"), "{}");
    fs.writeFileSync(path.join(config, "profiles.json"), "{}");
    fs.writeFileSync(path.join(config, "plugins", "device-common", "CricutDevice"), "");
    fs.writeFileSync(path.join(config, "plugins", "usvg", "usvg"), "");

    expect(getSlicebugSetupStatus(home, "darwin", null)).toMatchObject({
      hasKeys: true,
      hasProfiles: true,
      hasDevicePlugin: true,
      hasUsvg: true,
      bootstrapped: true,
    });
  });

  it("accepts bundled usvg as setup-ready when Design Space keys and plugins exist", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kindcut-slicebug-setup-"));
    const bundled = path.join(home, "bundle", "plugins", "usvg", "usvg");
    const config = path.join(home, ".slicebug");
    fs.mkdirSync(path.join(config, "plugins", "device-common"), { recursive: true });
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.writeFileSync(path.join(config, "keys.json"), "{}");
    fs.writeFileSync(path.join(config, "profiles.json"), "{}");
    fs.writeFileSync(path.join(config, "plugins", "device-common", "CricutDevice"), "");
    fs.writeFileSync(bundled, "");

    expect(getSlicebugSetupStatus(home, "darwin", bundled)).toMatchObject({
      hasKeys: true,
      hasProfiles: true,
      hasDevicePlugin: true,
      hasUsvg: true,
      usvgPath: bundled,
      bundledUsvgPath: bundled,
      bootstrapped: true,
    });
  });

  it("only treats bootstrap errors as success when bundled usvg covers a usvg download failure", () => {
    const setup = {
      bootstrapped: true,
      bundledUsvgPath: "/KindCut.app/Contents/Resources/slicebug/plugins/usvg/usvg",
    };

    expect(
      isBundledUsvgBootstrapFallback(
        {
          error: "Command failed: slicebug bootstrap",
          stderr: "Could not download usvg from linebender.",
          stdout: "",
        },
        setup,
      ),
    ).toBe(true);

    expect(
      isBundledUsvgBootstrapFallback(
        {
          error: "Command failed: slicebug bootstrap",
          stderr: "Design Space path does not exist.",
          stdout: "",
        },
        setup,
      ),
    ).toBe(false);
  });

  it("summarizes a successful SliceBug response", () => {
    expect(
      summarizeSlicebugResult({
        executable: "/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug",
        stdout: "0.3\n",
        stderr: "",
      }),
    ).toEqual({
      ok: true,
      executable: "/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug",
      version: "0.3",
      message: "SliceBug 0.3 is available.",
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

  it("builds a selectable non-cutting SVG plan request", () => {
    const request = buildSvgPlanRequest("/tmp/cricut-companion-plan", {
      svg: "<svg />",
      fileName: "Mom card.svg",
      materialId: 535,
      matPreset: "joy-card",
    });

    expect(request.inputSvgPath).toBe("/tmp/cricut-companion-plan/mom-card.svg");
    expect(request.outputPlanPath).toBe("/tmp/cricut-companion-plan/mom-card.json");
    expect(request.invocation).toEqual({
      args: [
        "plan",
        "/tmp/cricut-companion-plan/mom-card.svg",
        "/tmp/cricut-companion-plan/mom-card.json",
        "--material",
        "535",
        "--mat-preset",
        "joy-card",
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

  it("blocks cut sessions in smoke mode before spawning a process", () => {
    let spawned = false;
    const session = new SlicebugCutSession({
      id: "test-cut",
      executable: "slicebug",
      planPath: "/tmp/card.json",
      smokeMode: true,
      spawnProcess: () => {
        spawned = true;
        return new FakeCutProcess();
      },
    });

    expect(session.start()).toMatchObject({ status: "blocked" });
    expect(spawned).toBe(false);
  });

  it("starts a guarded Joy cut only from an explicit start call and waits before continuing", () => {
    const fake = new FakeCutProcess();
    const session = new SlicebugCutSession({
      id: "test-cut",
      executable: "slicebug",
      planPath: "/tmp/card.json",
      smokeMode: false,
      spawnProcess: (command, args) => {
        expect(command).toBe("slicebug");
        expect(args).toEqual(["cut", "--software-buttons", "/tmp/card.json"]);
        return fake;
      },
    });

    expect(session.getSnapshot().status).toBe("idle");
    const started = session.start();
    expect(started.status).toBe("running");
    expect(fake.stdinWrites).toEqual([]);

    fake.stdout.emit("data", Buffer.from("Insert/load mat and press Enter when ready\n"));
    expect(session.getSnapshot()).toMatchObject({
      status: "waiting",
      action: { kind: "load-mat", requiresContinue: true },
    });
    expect(fake.stdinWrites).toEqual([]);

    session.continue();
    expect(fake.stdinWrites).toEqual(["\n"]);

    fake.stdout.emit("data", Buffer.from("Cutting path 1 of 2\n"));
    expect(session.getSnapshot()).toMatchObject({ status: "running", action: { kind: "running" } });

    fake.stdout.emit("data", Buffer.from("Finished. Unload the mat.\n"));
    fake.emit("exit", 0);
    expect(session.getSnapshot()).toMatchObject({ status: "finished", action: { kind: "finished" } });
  });

  it("stops a running cut session through the process boundary", () => {
    const fake = new FakeCutProcess();
    const session = new SlicebugCutSession({
      id: "test-cut",
      executable: "slicebug",
      planPath: "/tmp/card.json",
      smokeMode: false,
      spawnProcess: () => fake,
    });

    session.start();
    expect(session.stop()).toMatchObject({ status: "stopped" });
    expect(fake.killed).toBe(true);
  });
});

class FakeCutProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdinWrites: string[] = [];
  killed = false;
  readonly stdin = {
    write: (text: string) => {
      this.stdinWrites.push(text);
      return true;
    },
  };

  kill() {
    this.killed = true;
    this.emit("exit", null);
    return true;
  }
}
