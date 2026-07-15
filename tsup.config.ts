import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  format: ["esm", "cjs"],
  minify: false,
  noExternal: ["spdx-license-ids"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node18",
  treeshake: true,
});
