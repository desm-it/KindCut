# Native Make on original Cricut Joy

Native Make supports the original Cricut Joy on macOS Apple Silicon with an explicitly supported firmware/profile. Other Cricut models and Smart/matless work are not part of this native release. Existing explicit SliceBug operation remains separate.

## Workflow

Open/create a project, select paper/cardstock, an insert card or the named on-mat vinyl, and open Make. Review the full design and tool Plan. Loading, starting each pen colour or blade and unloading each require your deliberate action. Normal application startup does not connect or move the machine. Keep the machine's travel area clear and follow the tool instructions shown in Make. An interrupted job is not resumed or replayed after restart; inspect the machine before starting a new attempt.

CardMat is explicit4.5×6.25 inches, not the ordinary4.5×6.5-inch short mat. Insert cards can include four actual corner cuts; choose card size and the corner-cut option. Cutting near an edge may be rejected because blade compensation extends outside the workpiece: move/resize the design in the editor rather than bypassing bounds.

Recipes identify actual source materials. On-mat vinyl types are Premium, Stencil, Holographic, Chalkboard and Dry Erase. Existing source20 projects remain Chalkboard Vinyl, not generic vinyl. Stock suitability, blade condition and cut depth require operator verification; catalog pressure values are not measured physical force.

## Automatic setup in2.1

On a new Mac, pair your original Joy once in macOS Bluetooth settings and allow KindCut's Bluetooth permission when macOS asks. Open Make: KindCut connects once, reuses matching saved device data or reads and saves the Joy's stored pressure-table data, then selects the exact material recipe and prepares your design. No Design Space installation, key import, calibration-file import or advanced-information toggle is required. If multiple paired Joys are found, choose yours; the app does not guess.

The setup read does not load a mat, start a tool, move the carriage or perform a mechanical calibration. Those actions remain separate deliberate controls. Matching custom material adjustments are preserved. Shared Joy initialization/decoder/catalog settings are bundled; per-device/session data is obtained from the connection and kept local, never included in release assets. On failure, setup stops and offers explicit retry; it does not repeatedly reconnect or power-cycle the machine. Advanced settings remain optional diagnostics.

## Installation / known limits

The macOS artifact is ad-hoc signed, not Developer ID notarized; Gatekeeper can require explicit approval. This release does not claim certified physical CardMat alignment, universally suitable stock recipes, emergency stopping, or unobserved fault recovery. Inert software tests are distinct from operator-observed trials. Existing production dependency advisories remain a separate tracked release-hardening task.

## Reproducible build

Use the committed npm lockfile (`npm ci`), the pinned Python build requirements and the immutable SliceBug revision in the release workflow. Set up the native runtime with the package setup command before running root checks on a clean checkout. Build releases on their target OS; native Joy is macOS-only. Never run hardware operations in CI or substitute synthetic calibration into a distributable.
