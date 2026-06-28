import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // During local development, forward /api calls to `vercel dev`
      // (which runs on port 3000 by default) so the frontend and the
      // serverless function can be developed together.
      "/api": "http://localhost:3000",
    },
  },
});
