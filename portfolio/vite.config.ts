import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The site itself has no build step: this folder is the portfolio's source, and `npm run build` writes plain static
// files into ../assets/portfolio/, which server.py serves at /portfolio. Commit the built files with the source.
export default defineConfig({
  base: "/assets/portfolio/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../assets/portfolio", emptyOutDir: true, assetsDir: "", chunkSizeWarningLimit: 1500 },
});
