import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  target: "es2022",
  logLevel: "info",
};

const contexts = await Promise.all([
  esbuild.context({
    ...shared,
    entryPoints: ["src/extension.ts"],
    format: "cjs",
    platform: "node",
    outfile: "out/extension.js",
    external: ["vscode"],
  }),
  // The chat panel runs in a webview; its stylesheet is written beside the script.
  esbuild.context({
    ...shared,
    entryPoints: ["src/webview/main.tsx"],
    format: "iife",
    platform: "browser",
    outfile: "out/webview.js",
    jsx: "automatic",
  }),
]);

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
