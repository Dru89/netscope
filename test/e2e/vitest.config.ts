import { defineConfig } from "vite";

// E2E runs drive one app instance at a time through a single tauri-driver
// port, so files must run sequentially.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
