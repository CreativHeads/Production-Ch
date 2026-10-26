import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, Django runs on :8000 and Vite proxies API + protected media to it,
// so cookies (session + CSRF) stay same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/media": "http://127.0.0.1:8000",
      "/django-admin": "http://127.0.0.1:8000",
      "/static": "http://127.0.0.1:8000",
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
