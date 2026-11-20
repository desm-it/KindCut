# Native Make on original Cricut Joy

Native Make supports the original Cricut Joy on macOS Apple Silicon with an explicitly supported firmware/profile. Other Cricut models and Smart/matless work are not part of this native release. Existing explicit SliceBug operation remains separate.

## Workflow
Open/create a project, select paper/cardstock, an insert card or the named on-mat vinyl, and open Make. Review the full design and tool Plan. Loading, starting each pen colour or blade and unloading each require your deliberate action. Normal application startup does not connect or move the machine. Keep the machine's travel area clear and follow the tool instructions shown in Make. An interrupted job is not resumed or replayed after restart; inspect the machine before starting a new attempt.

CardMat is explicit4.5×6.25 inches, not the ordinary4.5×6.5-inch short mat. Insert cards can include four actual corner cuts; choose card size and the corner-cut option. Cutting near an edge may be rejected because blade compensation extends outside the workpiece: move/resize the design in the editor rather than bypassing bounds.

Recipes identify actual source materials. On-mat vinyl types are Premium, Stencil, Holographic, Chalkboard and Dry Erase. Existing source20 projects remain Chalkboard Vinyl, not generic vinyl. Stock suitability, blade condition and cut depth require operator verification; catalog pressure values are not measured physical force.

## Device settings in2.0
For a device without saved settings, enable Show advanced info in Settings, return to Make and expand Material & calibration settings. Connect the supported Joy and explicitly read its calibration data, choose/save the applicable settings, then retry preparation. This reads device data; it is not a demonstrated mechanical calibration procedure. Never import another device's calibration or synthetic test data. Profiles and calibration persist locally in the app's normal data directory.

## Installation / known limits
The macOS artifact is ad-hoc signed, not Developer ID notarized; Gatekeeper can require explicit approval. This release does not claim certified physical CardMat alignment, universally suitable stock recipes, emergency stopping, or unobserved fault recovery. Inert software tests are distinct from operator-observed trials. Existing production dependency advisories remain a separate tracked release-hardening task.

## Reproducible build
Use the committed npm lockfile (`npm ci`), the pinned Python build requirements and the immutable SliceBug revision in the release workflow. Set up the native runtime with the package setup command before running root checks on a clean checkout. Build releases on their target OS; native Joy is macOS-only. Never run hardware operations in CI or substitute synthetic calibration into a distributable.
