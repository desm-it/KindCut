import { describe, expect, it } from "vitest";
import { isVersionAtLeast, shouldSuppressSkippedUpdate } from "./update-version";

const skippedUpdate = { version: "1.2.1", skippedAt: "2026-06-13T00:00:00.000Z" };

describe("updater version helpers", () => {
  it("compares semantic versions with multi-digit parts", () => {
    expect(isVersionAtLeast("1.2.10", "1.2.2")).toBe(true);
    expect(isVersionAtLeast("1.2.1", "1.2.2")).toBe(false);
    expect(isVersionAtLeast("1.2.1", "1.2.1")).toBe(true);
  });

  it("suppresses only the exact skipped version during automatic checks", () => {
    expect(shouldSuppressSkippedUpdate({ availableVersion: "1.2.1", interactive: false, skippedUpdate })).toBe(true);
    expect(shouldSuppressSkippedUpdate({ availableVersion: "1.2.2", interactive: false, skippedUpdate })).toBe(false);
    expect(shouldSuppressSkippedUpdate({ availableVersion: "1.2.1", interactive: true, skippedUpdate })).toBe(false);
    expect(shouldSuppressSkippedUpdate({ availableVersion: "1.2.1", interactive: false, skippedUpdate: null })).toBe(false);
  });
});
