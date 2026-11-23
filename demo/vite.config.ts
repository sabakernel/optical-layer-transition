import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@sabakernel/optical-layer-transition": new URL(
        "../packages/optical-layer-transition/mod.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
