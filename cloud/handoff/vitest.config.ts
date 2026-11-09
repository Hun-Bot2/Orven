import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(
  fileURLToPath(new URL("./migrations", import.meta.url)),
);

export default defineConfig({
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      // Explicit local bindings keep tests independent of remote resources and .dev.vars.
      miniflare: {
        compatibilityDate: "2026-11-09",
        d1Databases: ["DB"],
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
