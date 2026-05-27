const fs = require("node:fs");
const path = require("node:path");

const shellPackageJson = path.join(__dirname, "..", "dist", "main", "package.json");

fs.writeFileSync(shellPackageJson, `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
