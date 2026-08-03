import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["src/server/**/*.test.ts"],
    environment: "node",
    env: {
      PLEX_URL: "http://test-plex.invalid:32400",
      PLEX_TOKEN: "test-token",
      SESSION_SECRET: "test-secret-test-secret-test-secret",
      DB_PATH: ":memory:",
      ART_CACHE_DIR: "/tmp/movienight-test-art",
    },
  },
});
