import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    outDir: "www",
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "capacitor/main.js"),
      name: "CapBootstrap",
      formats: ["iife"],
      fileName: () => "capacitor-app.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    target: "es2019",
  },
});
