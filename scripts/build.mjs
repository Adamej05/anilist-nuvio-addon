// Bundles the addon into a single Vercel function using the Build Output API
// (https://vercel.com/docs/build-output-api) and a local dev server bundle.
import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";

const common = { bundle: true, platform: "node", target: "node22", format: "esm", logLevel: "info" };

const out = ".vercel/output";
const fn = `${out}/functions/index.func`;
await rm(out, { recursive: true, force: true });
await mkdir(fn, { recursive: true });

await build({ ...common, entryPoints: ["src/entry/vercel.ts"], outfile: `${fn}/index.mjs` });
await writeFile(
  `${fn}/.vc-config.json`,
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      maxDuration: 60,
      regions: ["fra1"],
    },
    null,
    2,
  ),
);
await writeFile(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      // Every path goes to the one function; the original URL is kept.
      routes: [{ src: "/(.*)", dest: "/index" }],
    },
    null,
    2,
  ),
);

await build({ ...common, entryPoints: ["src/entry/dev-server.ts"], outfile: "out/dev-server.mjs" });
console.log("built .vercel/output and out/dev-server.mjs");
