import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Unit tests run everywhere with no services. Integration tests need a
    // database and are selected explicitly, so a bare `vitest` stays fast.
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/server/**"],
      exclude: ["src/lib/supabase/**", "**/*.d.ts"],
      reporter: ["text-summary", "lcov"],
    },
  },
});
