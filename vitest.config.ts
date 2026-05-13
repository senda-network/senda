import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for unit-testing pure helpers in the Next.js app.
 *
 * Tests are intentionally narrow: pure functions only. We do not boot
 * Next.js, do not start a real server, and do not run jsdom — the
 * functions under test are framework-agnostic on purpose so the test
 * harness can stay minimal and fast (sub-second).
 */
export default defineConfig({
  test: {
    include: ["app/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app"),
    },
  },
});
