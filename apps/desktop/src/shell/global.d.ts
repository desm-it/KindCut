import type { CricutCompanionDesktopApi } from "./preload";

declare global {
  interface Window {
    cricutCompanion?: CricutCompanionDesktopApi;
  }
}

export {};
