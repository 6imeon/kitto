import { defineConfig } from "vitest/config";

// The CatStateMachine is pure (no DOM), so tests run in a plain Node environment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
