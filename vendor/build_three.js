/* build_three.js: rebuild three.min.js, the Three.js bundle inlined into the film, from the pinned package, and prepend its MIT notice.
   Run (in this folder):  npm install   then   npm run build
   Author:  Muhammad Akhtar Shamim
   Licence: MIT (see LICENSE)
   Created: 2026-11-21 */
const { execSync } = require("child_process"), fs = require("fs"), path = require("path");

const HERE = __dirname;
const BODY = path.join(HERE, "three.body.js");

/** Bundle three-entry.js with esbuild, then write three.min.js with the package's licence text on top. */
function main() {
  const version = JSON.parse(fs.readFileSync(path.join(HERE, "node_modules", "three", "package.json"))).version;
  execSync("npx esbuild three-entry.js --bundle --minify --format=iife --global-name=THREE --legal-comments=none --outfile=three.body.js", { cwd: HERE, stdio: "inherit" });
  const licence = fs.readFileSync(path.join(HERE, "node_modules", "three", "LICENSE"), "utf8").trim().split("\n").map(function (line) { return " * " + line; }).join("\n");
  const header = "/*! Three.js bundle. THIRD-PARTY COMPONENT with its own licence (MIT, below); see THIRD-PARTY.md.\n" +
    " * Package: three " + version + ", tree-shaken to the classes listed in three-entry.js.\n" + licence + "\n */\n";
  fs.writeFileSync(path.join(HERE, "three.min.js"), header + fs.readFileSync(BODY, "utf8"));
  fs.unlinkSync(BODY);
  console.log("wrote three.min.js (three " + version + ")");
}

main();
