import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@cricut-companion/craft-core": fileURLToPath(new URL("../../packages/craft-core/src/index.ts", import.meta.url)),
      "@cricut-companion/svg-preflight": fileURLToPath(new URL("../../packages/svg-preflight/src/index.ts", import.meta.url)),
      "@cricut-companion/ai-designer": fileURLToPath(new URL("../../packages/ai-designer/src/index.ts", import.meta.url)),
      "@cricut-companion/slicebug-bridge": fileURLToPath(new URL("../../packages/slicebug-bridge/src/index.ts", import.meta.url))
    }
  }
});
