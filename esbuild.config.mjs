import esbuild from "esbuild";

const production = process.argv.includes("production");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: "main.js",
  sourcemap: !production,
  minify: production,
  external: ["obsidian", "electron", "node:child_process", "node:fs", "node:path", "node:util"],
  logLevel: "info",
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
