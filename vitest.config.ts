import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: ["src/**/*.d.ts"],
      include: [
        "src/config/**/*.ts",
        "src/license/**/*.ts",
        "src/lockfile/**/*.ts",
        "src/policy/**/*.ts",
      ],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    include: ["test/**/*.test.ts"],
  },
});
