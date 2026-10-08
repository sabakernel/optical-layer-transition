import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@sabakernel/optical-layer-transition":
        new URL("../mod.ts", import.meta.url)
          .pathname,
    },
  },
});
