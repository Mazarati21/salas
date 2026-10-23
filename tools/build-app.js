const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "app.jsx");
const sourceHash = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");

esbuild.buildSync({
  entryPoints: [sourcePath],
  outfile: path.join(root, "app.js"),
  format: "iife",
  platform: "browser",
  jsx: "transform",
  minify: true,
  banner: { js: `/* LegendZ source:${sourceHash} */` }
});

console.log(`app.js criado a partir de app.jsx (${sourceHash.slice(0, 12)}).`);
