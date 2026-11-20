export type CutterBackendPreference = "auto" | "native" | "slicebug";
export type CutterOperation = "cut" | "status";
export type CutterRoute = "native" | "slicebug" | "blocked";

/** Native cutting is not implemented; Auto must never silently fall back for a cut. */
export function routeCutterBackend(
  preference: CutterBackendPreference,
  operation: CutterOperation,
  nativeSupported: boolean,
): CutterRoute {
  if (preference === "slicebug") return "slicebug";
  if (preference === "native") return nativeSupported ? "native" : "blocked";
  if (operation === "cut") return "blocked";
  return nativeSupported ? "native" : "slicebug";
}
