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
  // `ink-testing-library` hard-imports the vanilla `ink` package, but the
  // CLI is built against the `@jrichman/ink` fork (per CLI_ROADMAP.md
  // architecture decision). The two share the same React + Ink component
  // API surface, so aliasing the `ink` specifier through to the fork lets
  // the testing library drive our components without us installing a
  // second copy of Ink. We also need to inline ink-testing-library so the
  // alias is applied to its compiled JS (Vitest does not rewrite ESM
  // specifiers inside `node_modules` by default).
  resolve: {
    alias: {
      ink: "@jrichman/ink",
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "dist"],
    server: {
      deps: {
        inline: ["ink-testing-library"],
      },
    },
  },
});
