import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Tauri expects a fixed dev port (tauri.conf.json devUrl)
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    exclude: ["test/e2e/**", "node_modules/**", "site/**"],
  },
});
