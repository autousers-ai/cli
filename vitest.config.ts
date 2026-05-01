/**
 * Vitest config for the @autousers/cli package.
 *
 * The CLI lives inside the autousers monorepo and shares the parent's
 * `vitest` install via npm workspace hoisting. We don't need the parent's
 * jsdom environment, setup files, or `@/*` alias here — the CLI is a
 * pure Node.js package with no React or app code in its dependency
 * graph. Keeping a tiny local config means `cd cli && npx vitest run`
 * works without leaning on the parent's jsdom setup file.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "dist"],
  },
});
