export const ADVANCED_INFO_STORAGE_KEY = "kindcut.show-advanced-info";

export function loadAdvancedInfoPreference(storage?: Pick<Storage, "getItem">): boolean {
  try { return (storage ?? (typeof window === "undefined" ? undefined : window.localStorage))?.getItem(ADVANCED_INFO_STORAGE_KEY) === "true"; } catch { return false; }
}

export function saveAdvancedInfoPreference(value: boolean, storage?: Pick<Storage, "setItem">): void {
  try { (storage ?? (typeof window === "undefined" ? undefined : window.localStorage))?.setItem(ADVANCED_INFO_STORAGE_KEY, String(value)); } catch { /* Preference is optional; keep the in-memory setting. */ }
}
