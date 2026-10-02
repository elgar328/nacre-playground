import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the same build runs at the site root locally and under
  // `/nacre-playground/` on GitHub Pages.
  base: "./",
  // The example scripts live beside `web/`, in the repository's `examples/`.
  server: { fs: { allow: [".."] } },
});
