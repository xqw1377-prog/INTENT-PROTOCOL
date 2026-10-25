import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@intent/hackathon-escrow": fileURLToPath(new URL("../packages/hackathon-escrow/src/index.ts", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
