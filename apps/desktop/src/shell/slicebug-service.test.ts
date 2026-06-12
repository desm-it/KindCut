import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SlicebugCutSession,
  buildBootstrapInvocation,
  buildBootstrapCandidateInputs,
  buildSamplePlanRequest,
  buildSlicebugSubprocessEnv,
  buildSvgPlanRequest,
  buildSlicebugInvocation,
  buildListMaterialsInvocation,
  bundledSlicebugExecutablePath,
  bundledUsvgExecutablePath,
  defaultDesignSpacePaths,
  defaultDesignSpacePathCandidates,
  defaultDesignSpaceProfilePathCandidates,
  desktopResourceSlicebugExecutablePath,
  desktopResourceUsvgExecutablePath,
  findDesignSpaceMachineProfileSerials,
  findBundledUsvgCandidates,
  findSlicebugExecutableCandidates,
  getSlicebugSetupStatus,
  isRecoverableCricutDeviceStartError,
  isBundledUsvgBootstrapFallback,
  parseWindowsTasklistImageNames,
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
      path.join("/Applications/KindCut.app/Contents/Resources", "slicebug", "slicebug"),
      path.join("/repo/apps/desktop", "resources", "slicebug", "slicebug"),
      path.join("/repo", "vendor", "slicebug", ".venv", "bin", "slicebug"),
      "/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug",
      "slicebug",
    ]);
  });

  it("builds platform-specific bundled SliceBug and usvg paths", () => {
    expect(bundledSlicebugExecutablePath("/resources", "darwin")).toBe(path.join("/resources", "slicebug", "slicebug"));
    expect(bundledUsvgExecutablePath("/resources", "darwin")).toBe(
      path.join("/resources", "slicebug", "plugins", "usvg", "usvg"),
    );
    expect(bundledSlicebugExecutablePath("C:\\KindCut\\resources", "win32")).toBe(
      path.join("C:\\KindCut\\resources", "slicebug", "slicebug.exe"),
    );
    expect(bundledUsvgExecutablePath("C:\\KindCut\\resources", "win32")).toBe(
      path.join("C:\\KindCut\\resources", "slicebug", "plugins", "usvg", "usvg.exe"),
    );
    expect(desktopResourceSlicebugExecutablePath("/repo/apps/desktop", "darwin")).toBe(
      path.join("/repo/apps/desktop", "resources", "slicebug", "slicebug"),
    );
    expect(desktopResourceUsvgExecutablePath("/repo/apps/desktop", "darwin")).toBe(
      path.join("/repo/apps/desktop", "resources", "slicebug", "plugins", "usvg", "usvg"),
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
      path.join("/missing/app", "resources", "slicebug", "plugins", "usvg", "usvg"),
      path.join("/missing/repo", "apps", "desktop", "resources", "slicebug", "plugins", "usvg", "usvg"),
    ]);

    const env = buildSlicebugSubprocessEnv({
      platform: "darwin",
      resourcesPath: resources,
      appRoot: "/missing/app",
      repoRoot: "/missing/repo",
    });
    expect(env.PATH?.split(path.delimiter)[0]).toBe(path.dirname(usvg));
  });

  it("passes SliceBug debug log location through subprocess env", () => {
    const previous = process.env.SLICEBUG_DEBUG_LOG;
    process.env.SLICEBUG_DEBUG_LOG = path.join("/tmp", "kindcut-logs", "slicebug-debug.log");
    try {
      const env = buildSlicebugSubprocessEnv({
        platform: "darwin",
        resourcesPath: "/missing/resources",
        appRoot: "/missing/app",
        repoRoot: "/missing/repo",
      });

      expect(env.SLICEBUG_DEBUG_LOG).toBe(path.join("/tmp", "kindcut-logs", "slicebug-debug.log"));
    } finally {
      if (previous === undefined) {
        delete process.env.SLICEBUG_DEBUG_LOG;
      } else {
        process.env.SLICEBUG_DEBUG_LOG = previous;
      }
    }
  });

  it("builds only the safe non-cutting status invocation", () => {
    expect(buildSlicebugInvocation()).toEqual({ args: ["--version"] });
  });

  it("builds only the safe non-cutting material validation invocation", () => {
    expect(buildListMaterialsInvocation()).toEqual({ args: ["list-materials"] });
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
      designSpaceProfilePath: path.join("/Users/test", ".cricut-design-space"),
    });
    expect(defaultDesignSpacePaths("win32", "C:\\Users\\Test")).toEqual({
      designSpacePath: path.join("C:\\Users\\Test", "AppData", "Local", "Programs", "Cricut Design Space"),
      designSpaceProfilePath: path.join("C:\\Users\\Test", ".cricut-design-space"),
    });
  });

  it("tries alternate Windows Design Space install and profile paths during bootstrap", () => {
    const home = "C:\\Users\\Test";

    expect(defaultDesignSpacePathCandidates("win32", home)).toEqual([
      path.join(home, "AppData", "Local", "Programs", "Cricut Design Space"),
      path.join(home, "AppData", "Local", "Program", "Cricut Design Space"),
      path.join(home, "AppData", "Local", "Cricut Design Space"),
    ]);
    expect(defaultDesignSpaceProfilePathCandidates("win32", home)).toEqual([
      path.join(home, ".cricut-design-space"),
      path.join(home, "AppData", "Roaming", "Cricut Design Space"),
      path.join(home, "AppData", "Local", "Cricut Design Space"),
      path.join(home, "AppData", "Local", "Programs", "Cricut Design Space"),
      path.join(home, "AppData", "Local", "Program", "Cricut Design Space"),
    ]);

    expect(buildBootstrapCandidateInputs({}, "win32", home)).toHaveLength(15);
  });

  it("respects explicit bootstrap paths while filling in only missing defaults", () => {
    const home = "C:\\Users\\Test";
    const explicitProfile = "D:\\Profiles\\DesignSpace";

    expect(
      buildBootstrapCandidateInputs(
        {
          designSpaceProfilePath: explicitProfile,
        },
        "win32",
        home,
      ),
    ).toEqual([
      {
        designSpacePath: path.join(home, "AppData", "Local", "Programs", "Cricut Design Space"),
        designSpaceProfilePath: explicitProfile,
      },
      {
        designSpacePath: path.join(home, "AppData", "Local", "Program", "Cricut Design Space"),
        designSpaceProfilePath: explicitProfile,
      },
      {
        designSpacePath: path.join(home, "AppData", "Local", "Cricut Design Space"),
        designSpaceProfilePath: explicitProfile,
      },
    ]);
  });

  it("parses Windows tasklist CSV image names", () => {
    expect(
      parseWindowsTasklistImageNames(
        [
          '"Cricut Design Space.exe","1234","Console","1","100,000 K"',
          '"CricutDevice.exe","2345","Console","1","10,000 K"',
          '"explorer.exe","3456","Console","1","50,000 K"',
        ].join("\r\n"),
      ),
    ).toEqual(["Cricut Design Space.exe", "CricutDevice.exe", "explorer.exe"]);
  });

  it("finds Design Space machine profile serials without running SliceBug", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kindcut-design-space-profile-"));
    const materialRoot = path.join(root, "LocalData", "user-1", "MaterialSettings", "JOY123");
    fs.mkdirSync(materialRoot, { recursive: true });
    fs.writeFileSync(path.join(materialRoot, "MaterialSettings"), "{}");

    expect(findDesignSpaceMachineProfileSerials(root)).toEqual(["JOY123"]);
  });

  it("detects whether SliceBug has been bootstrapped without touching hardware", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kindcut-slicebug-setup-"));
    const config = path.join(home, ".slicebug");
    fs.mkdirSync(path.join(config, "plugins", "device-common"), { recursive: true });
    fs.mkdirSync(path.join(config, "plugins", "usvg"), { recursive: true });

    expect(getSlicebugSetupStatus(home, "darwin", null)).toMatchObject({
      hasKeys: false,
      hasProfiles: false,
      hasMachineProfile: false,
      machineProfileCount: 0,
      profileNames: [],
      hasDevicePlugin: false,
      hasUsvg: false,
      bootstrapped: false,
    });

    fs.writeFileSync(path.join(config, "keys.json"), "{}");
    fs.writeFileSync(
      path.join(config, "profiles.json"),
      JSON.stringify({ version: 1, profiles: { default: { serial: "JOY123" } } }),
    );
    fs.mkdirSync(path.join(config, "profiles", "JOY123"), { recursive: true });
    fs.writeFileSync(path.join(config, "profiles", "JOY123", "material_settings.json"), "{}");
    fs.writeFileSync(path.join(config, "plugins", "device-common", "CricutDevice"), "");
    fs.writeFileSync(path.join(config, "plugins", "usvg", "usvg"), "");

    expect(getSlicebugSetupStatus(home, "darwin", null)).toMatchObject({
      hasKeys: true,
      hasProfiles: true,
      hasMachineProfile: true,
      machineProfileCount: 1,
      profileNames: ["default"],
      missingMaterialSettingsPaths: [],
      hasDevicePlugin: true,
      hasUsvg: true,
      bootstrapped: true,
    });
  });

  it("does not treat an empty profiles file as setup-ready", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kindcut-slicebug-empty-profiles-"));
    const config = path.join(home, ".slicebug");
    fs.mkdirSync(path.join(config, "plugins", "device-common"), { recursive: true });
    fs.mkdirSync(path.join(config, "plugins", "usvg"), { recursive: true });
    fs.writeFileSync(path.join(config, "keys.json"), "{}");
    fs.writeFileSync(path.join(config, "profiles.json"), JSON.stringify({ version: 1, profiles: {} }));
    fs.writeFileSync(path.join(config, "plugins", "device-common", "CricutDevice.exe"), "");
    fs.writeFileSync(path.join(config, "plugins", "usvg", "usvg.exe"), "");

    expect(getSlicebugSetupStatus(home, "win32", null)).toMatchObject({
      hasKeys: true,
      hasProfiles: true,
      hasMachineProfile: false,
      machineProfileCount: 0,
      profileNames: [],
      hasDevicePlugin: true,
      hasUsvg: true,
      bootstrapped: false,
    });
  });

  it("does not treat a profile without material settings as setup-ready", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kindcut-slicebug-missing-materials-"));
    const config = path.join(home, ".slicebug");
    fs.mkdirSync(path.join(config, "plugins", "device-common"), { recursive: true });
    fs.mkdirSync(path.join(config, "plugins", "usvg"), { recursive: true });
    fs.writeFileSync(path.join(config, "keys.json"), "{}");
    fs.writeFileSync(
      path.join(config, "profiles.json"),
      JSON.stringify({ version: 1, profiles: { default: { serial: "JOY123" } } }),
    );
    fs.writeFileSync(path.join(config, "plugins", "device-common", "CricutDevice.exe"), "");
    fs.writeFileSync(path.join(config, "plugins", "usvg", "usvg.exe"), "");

    const setup = getSlicebugSetupStatus(home, "win32", null);
    expect(setup).toMatchObject({
      hasMachineProfile: true,
      machineProfileCount: 1,
      profileNames: ["default"],
      bootstrapped: false,
    });
    expect(setup.missingMaterialSettingsPaths).toEqual([
      path.join(config, "profiles", "JOY123", "material_settings.json"),
    ]);
  });

  it("accepts bundled usvg as setup-ready when Design Space keys and plugins exist", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kindcut-slicebug-setup-"));
    const bundled = path.join(home, "bundle", "plugins", "usvg", "usvg");
    const config = path.join(home, ".slicebug");
    fs.mkdirSync(path.join(config, "plugins", "device-common"), { recursive: true });
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.writeFileSync(path.join(config, "keys.json"), "{}");
    fs.writeFileSync(
      path.join(config, "profiles.json"),
      JSON.stringify({ version: 1, profiles: { default: { serial: "JOY123" } } }),
    );
    fs.mkdirSync(path.join(config, "profiles", "JOY123"), { recursive: true });
    fs.writeFileSync(path.join(config, "profiles", "JOY123", "material_settings.json"), "{}");
    fs.writeFileSync(path.join(config, "plugins", "device-common", "CricutDevice"), "");
    fs.writeFileSync(bundled, "");

    expect(getSlicebugSetupStatus(home, "darwin", bundled)).toMatchObject({
      hasKeys: true,
      hasProfiles: true,
      hasMachineProfile: true,
      missingMaterialSettingsPaths: [],
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
    const workspaceDir = path.join("/tmp", "cricut-companion-plan");
    const request = buildSamplePlanRequest(workspaceDir);
    const inputSvgPath = path.join(workspaceDir, "sample-card.svg");
    const outputPlanPath = path.join(workspaceDir, "sample-card.json");

    expect(request.inputSvgPath).toBe(inputSvgPath);
    expect(request.outputPlanPath).toBe(outputPlanPath);
    expect(request.svg).toContain("stroke=\"#ff0000\"");
    expect(request.invocation).toEqual({
      args: [
        "plan",
        inputSvgPath,
        outputPlanPath,
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
    const workspaceDir = path.join("/tmp", "cricut-companion-plan");
    const request = buildSvgPlanRequest(workspaceDir, {
      svg: "<svg />",
      fileName: "Mom card.svg",
      materialId: 535,
      matPreset: "joy-card",
    });
    const inputSvgPath = path.join(workspaceDir, "mom-card.svg");
    const outputPlanPath = path.join(workspaceDir, "mom-card.json");

    expect(request.inputSvgPath).toBe(inputSvgPath);
    expect(request.outputPlanPath).toBe(outputPlanPath);
    expect(request.invocation).toEqual({
      args: [
        "plan",
        inputSvgPath,
        outputPlanPath,
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

  it("turns missing machine profile plan failures into setup guidance", () => {
    expect(
      summarizePlanResult({
        executable: "slicebug.exe",
        stdout: "",
        stderr: "Error: A machine profile is required to run this command, but it was not found.\nTry running `slicebug bootstrap`.",
        error: "Command failed: slicebug.exe plan",
        inputSvgPath: "C:\\Temp\\text.svg",
        outputPlanPath: "C:\\Temp\\text.json",
      }),
    ).toMatchObject({
      ok: false,
      executable: "slicebug.exe",
      message: expect.stringContaining("does not have a machine profile yet"),
      plan: null,
    });
  });

  it("logs malformed SliceBug plan output to the console", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = summarizePlanResult({
        executable: "slicebug",
        stdout: "wrote plan",
        stderr: "",
        inputSvgPath: "/tmp/input.svg",
        outputPlanPath: "/tmp/output.json",
        planJson: "{bad json",
      });

      expect(result).toMatchObject({ ok: false, message: "wrote plan" });
      expect(consoleError).toHaveBeenCalledWith(
        "[SliceBug] Failed to parse plan output",
        expect.objectContaining({
          executable: "slicebug",
          inputSvgPath: "/tmp/input.svg",
          outputPlanPath: "/tmp/output.json",
          planJson: "{bad json",
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
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

  it("logs cut session stderr and non-zero exits", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const fake = new FakeCutProcess();
      const session = new SlicebugCutSession({
        id: "test-cut",
        executable: "slicebug",
        planPath: "/tmp/card.json",
        smokeMode: false,
        spawnProcess: () => fake,
      });

      session.start();
      fake.stderr.emit("data", Buffer.from("Failed to connect to cutter\n"));
      fake.emit("exit", 1);

      expect(session.getSnapshot()).toMatchObject({ status: "error" });
      expect(consoleError).toHaveBeenCalledWith(
        "[SliceBug] Cut session stderr",
        expect.objectContaining({ stderr: "Failed to connect to cutter\n", planPath: "/tmp/card.json" }),
      );
      expect(consoleError).toHaveBeenCalledWith(
        "[SliceBug] Cut session exited with an error",
        expect.objectContaining({ exitCode: 1, planPath: "/tmp/card.json" }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("turns Windows cutter connection failures into friendly cut guidance", () => {
    const fake = new FakeCutProcess();
    const session = new SlicebugCutSession({
      id: "test-cut",
      executable: "slicebug",
      planPath: "/tmp/card.json",
      smokeMode: false,
      spawnProcess: () => fake,
    });

    session.start();
    fake.stderr.emit("data", Buffer.from("EOFError: Plugin stdout closed while reading message\n"));
    fake.emit("exit", 1);

    expect(session.getSnapshot()).toMatchObject({
      status: "error",
      action: {
        message: expect.stringContaining("Close Design Space"),
      },
    });
  });

  it("detects the CricutDevice start-status error that can be repaired by bootstrap", () => {
    expect(
      isRecoverableCricutDeviceStartError(
        "slicebug.exceptions.ProtocolError: incorrect message status: expected 2, got 0",
      ),
    ).toBe(true);
    expect(isRecoverableCricutDeviceStartError("EOFError: Plugin stdout closed while reading message")).toBe(false);
  });

  it("runs bootstrap recovery once when CricutDevice rejects cut startup", async () => {
    const fake = new FakeCutProcess();
    const recoverFromHandshakeError = vi.fn(async () => ({
      ok: true,
      executable: "slicebug",
      stdout: "setup ok\n",
      stderr: "",
      message: "SliceBug setup completed.",
    }));
    const session = new SlicebugCutSession({
      id: "test-cut",
      executable: "slicebug",
      planPath: "/tmp/card.json",
      smokeMode: false,
      spawnProcess: () => fake,
      recoverFromHandshakeError,
    });

    session.start();
    fake.stderr.emit(
      "data",
      Buffer.from(
        [
          "Traceback (most recent call last):",
          "slicebug.exceptions.ProtocolError: incorrect message status: expected 2, got 0",
          "",
        ].join("\n"),
      ),
    );
    fake.emit("exit", 1);

    expect(session.getSnapshot()).toMatchObject({
      status: "running",
      action: {
        title: "Refreshing helper setup",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(recoverFromHandshakeError).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toMatchObject({
      status: "error",
      action: {
        title: "Helper setup refreshed",
        message: expect.stringContaining("start the cut again"),
      },
      transcript: expect.stringContaining("KindCut refreshed the helper setup."),
    });
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
