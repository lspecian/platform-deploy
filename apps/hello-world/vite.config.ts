import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    // Built into the API's static directory: one container serves both the SPA
    // and the API, so there is one artifact to promote and one thing to deploy.
    outDir: "../dist/public",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Local dev only. In every deployed environment the API serves these files
    // itself, so there is no cross-origin hop and no CORS configuration.
    proxy: { "/api": "http://localhost:8080" },
  },
});
