import path from "node:path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  // Avoid loading the app's .env.local so tests never pick up production Mongo URIs.
  envDir: path.resolve(import.meta.dirname, "tests/vitest-env"),
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: [
        "src/server/api/**/*.ts",
        "src/server/auth/**/*.ts",
        "src/server/db/models/**/*.ts",
        "src/app/api/customers/[id]/route.ts",
      ],
      exclude: ["**/*.d.ts", "**/node_modules/**"],
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
