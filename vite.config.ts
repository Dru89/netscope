import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import electronRenderer from "vite-plugin-electron-renderer";

// Tauri builds must not bundle (or launch) the Electron main process. The
// Tauri CLI sets TAURI_ENV_* for its beforeDevCommand/beforeBuildCommand
// hooks, so its presence tells us which shell this build is for.
const isTauriBuild = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  define: {
    __BUILD_CHANNEL__: JSON.stringify(process.env.BUILD_CHANNEL ?? "latest"),
  },
  plugins: [
    react(),
    ...(isTauriBuild
      ? []
      : electronPlugins()),
  ],
  test: {
    exclude: ["test/e2e/**", "node_modules/**", "site/**"],
  },
});

function electronPlugins() {
  return [
    electron([
      {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
      {
        entry: "electron/preload.ts",
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
    ]),
    electronRenderer(),
  ];
}
