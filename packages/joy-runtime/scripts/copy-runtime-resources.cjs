const fs = require('node:fs');
/** Preserve PyInstaller's relative framework links so the copied app is relocatable/signable. */
function copyRuntimeResources(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(source, destination, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
}
module.exports = { copyRuntimeResources };
