import { describe, expect, it } from "vitest";
import { acquireCutterEntry, type CutterEntryPorts } from "./cutter-entry.js";

function fixture(overrides: Partial<CutterEntryPorts<string>> = {}) {
  const calls: string[] = [];
  let busy = false;
  let native = false;
  const ports: CutterEntryPorts<string> = {
    acquire: () => { if (busy) return false; busy = true; calls.push("acquire"); return true; },
    release: () => { busy = false; calls.push("release"); },
    readBackend: async () => "slicebug",
    nativeOwnsHardware: () => native,
    confirmFallback: async () => false,
    confirmDisconnect: async () => false,
    disconnectNative: async () => { native = false; calls.push("disconnect"); },
    start: async () => { calls.push("start"); return "started"; },
    ...overrides,
  };
  return { ports, calls, isBusy: () => busy };
}

describe("acquireCutterEntry", () => {
  it("rejects corrupt preferences instead of implicitly selecting SliceBug", async () => {
    const f=fixture({readBackend:async()=>"unknown" as never});
    await expect(acquireCutterEntry(f.ports)).rejects.toThrow(/backend/i);
    expect(f.calls).toEqual(["acquire","release"]);
  });
  it("leaves the native session alone when switching is declined",async()=>{
    const f=fixture({nativeOwnsHardware:()=>true,confirmDisconnect:async()=>false});
    await expect(acquireCutterEntry(f.ports)).rejects.toThrow(/remains connected/);
    expect(f.calls).toEqual(["acquire","release"]);
  });
  it("holds the lease throughout a confirmed deferred disconnect",async()=>{
    let native=true,release!:()=>void;
    const f=fixture({nativeOwnsHardware:()=>native,confirmDisconnect:async()=>true,disconnectNative:()=>new Promise<void>(resolve=>{release=()=>{native=false;resolve();};})});
    const first=acquireCutterEntry(f.ports);
    await Promise.resolve();await Promise.resolve();
    expect(f.isBusy()).toBe(true);expect(f.calls).toEqual(["acquire"]);
    await expect(acquireCutterEntry(f.ports)).rejects.toThrow(/already starting/);
    release();await expect(first).resolves.toBe("started");expect(f.calls).toEqual(["acquire","start","release"]);
  });
  it("acquires synchronously before settings read and releases after start settles", async () => {
    const f = fixture({ readBackend: async () => { expect(f.isBusy()).toBe(true); return "slicebug"; } });
    await expect(acquireCutterEntry(f.ports)).resolves.toBe("started");
    expect(f.calls).toEqual(["acquire", "start", "release"]);
  });
  it("rejects duplicate entries without releasing the other entry's lock", async () => {
    const f = fixture(); f.ports.acquire();
    await expect(acquireCutterEntry(f.ports)).rejects.toThrow("already starting");
    expect(f.calls).toEqual(["acquire"]);
  });
  it("blocks native-only mode without starting", async () => {
    const f = fixture({ readBackend: async () => "native" });
    await expect(acquireCutterEntry(f.ports)).rejects.toThrow("Native cutting is not available");
    expect(f.calls).toEqual(["acquire", "release"]);
  });
  it("cancels auto fallback without starting", async () => {
    const f = fixture({ readBackend: async () => "auto", confirmFallback: async () => false });
    await expect(acquireCutterEntry(f.ports)).rejects.toThrow("Cut canceled");
    expect(f.calls).toEqual(["acquire", "release"]);
  });
  it("uses explicit fallback confirmation only for auto mode", async () => {
    const f = fixture({ readBackend: async () => "auto", confirmFallback: async () => true });
    await expect(acquireCutterEntry(f.ports)).resolves.toBe("started");
    expect(f.calls).toEqual(["acquire", "start", "release"]);
  });
  it("requires confirmation and disconnects native ownership before rejecting if retained", async () => {
    let native = true;
    const f = fixture({ nativeOwnsHardware: () => native, confirmDisconnect: async () => true, disconnectNative: async () => { f.calls.push("disconnect"); } });
    await expect(acquireCutterEntry(f.ports)).rejects.toThrow("ownership could not be released");
    expect(f.calls).toEqual(["acquire", "disconnect", "release"]);
  });
  it("holds lock during deferred confirmation and disconnect", async () => {
    let resolve!: (value: boolean) => void;
    const f = fixture({ readBackend: async () => "auto", confirmFallback: () => new Promise<boolean>(r => { resolve = r; }) });
    const first = acquireCutterEntry(f.ports);
    await Promise.resolve();
    expect(f.isBusy()).toBe(true);
    await expect(acquireCutterEntry(f.ports)).rejects.toThrow("already starting");
    resolve(true);
    await expect(first).resolves.toBe("started");
  });
  it("releases on start failure and does not retry", async () => {
    let count = 0;
    const f = fixture({ start: async () => { count++; throw new Error("failed"); } });
    await expect(acquireCutterEntry(f.ports)).rejects.toThrow("failed");
    expect(count).toBe(1); expect(f.isBusy()).toBe(false);
  });
});