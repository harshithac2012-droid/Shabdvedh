import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    proxy: {
      "/events": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/latest": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/cmd": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});