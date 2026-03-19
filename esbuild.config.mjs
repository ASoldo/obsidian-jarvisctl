import esbuild from "esbuild";
import Vue from "unplugin-vue/esbuild";

const production = process.argv.includes("production");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "chrome120",
  outfile: "main.js",
  sourcemap: !production,
  minify: production,
  external: ["obsidian", "electron", "node:child_process", "node:fs", "node:path", "node:util"],
  plugins: [Vue()],
  loader: {
    ".vue": "js",
  },
  define: {
    __VUE_OPTIONS_API__: "false",
    __VUE_PROD_DEVTOOLS__: "false",
  },
  logLevel: "info",
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
