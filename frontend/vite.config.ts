import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies API + static image requests to the FastAPI backend so the
// frontend can use same-origin relative URLs ("/api/...", "/files/...").
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/files": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
});
