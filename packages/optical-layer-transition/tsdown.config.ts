import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["mod.ts"],
  format: ["esm"],
  dts: true,
  platform: "neutral",
  outputOptions: {
    exports: "named",
  },
});
