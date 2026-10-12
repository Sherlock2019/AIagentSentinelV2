import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = process.env.VITE_BACKEND_URL || "http://127.0.0.1:8000";
// Set by `./start.sh --public` (and automatically on AWS EC2).
const isPublic = process.env.SENTINEL_PUBLIC === "1";
const toBackend = { target: backend, changeOrigin: true };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Public mode is reached by IP or an EC2 hostname, so the Host header cannot be pinned.
    allowedHosts: isPublic ? true : undefined,
    // The UI talks to the API through same-origin paths; Vite forwards them. This is also
    // why only ONE port has to be opened publicly: the backend stays bound to localhost.
    proxy: {
      "/api": toBackend,
      "/health": toBackend,
      "/docs": toBackend,
      "/openapi.json": toBackend,
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
