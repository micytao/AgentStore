// Bundles this container's entrypoint with esbuild instead of plain `tsc`.
//
// `@agentstore/agent-core` and `@agentstore/shared` ship as raw TypeScript
// source (see their package.json `main`) — apps/web relies on Next.js's
// `transpilePackages` to transpile them at build time, but this app is a
// plain Node process with no bundler of its own, so `tsc`-then-`node
// dist/server.js` fails at runtime: Node can't resolve their extensionless
// internal imports (e.g. `./providers`) as raw `.ts` files. esbuild both
// transpiles and inlines those two workspace packages directly into
// dist/server.js, so the built output is plain, self-contained CJS that
// plain `node` can run — matching how @modelcontextprotocol/sdk (a real
// published package, left external) already just works via node_modules.
import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  logLevel: "info",
  external: ["@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*"],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("esbuild watching for changes...");
} else {
  await esbuild.build(options);
}
