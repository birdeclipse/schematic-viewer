# schematic-viewer

Static SPICE/CDL schematic viewer. Plain JS, no build step, no runtime dependencies: `index.html` loads the scripts
in order and the same files ship unchanged inside the VS Code / Cursor extension. Read `docs/architecture.md` before
touching layout, rail detection, or cross-coupled cell rendering; `docs/netlist-support.md` is the parser contract.

## Layout

| File | Role |
|---|---|
| `spice.js` | Parser + per-cell supply resolution (`SPICE.parse`, `computeRails`, `setRailPatterns`) |
| `tojson.js` | Sub-circuit → Yosys JSON for netlistsvg (`toYosys(def, netlist)`) |
| `xcouple.js` | Cross-coupled core detector and its hand-drawn SVG symbol (`XC.find`, `XC.symbol`) |
| `skin.js` | netlistsvg skin: MOS/rail/port/label glyphs, as a JS string |
| `layout.js` | Row assignment, ELK run, interactive re-layout after a drag (`LAYOUT.render`) |
| `app.js` | UI glue: tree, breadcrumb, highlight, pan/zoom/grid, drag to place (local re-route, Shift = ELK re-layout), host messaging |
| `extension.js` | VS Code custom editor; rewrites `index.html` script tags to webview URIs |
| `examples.js` | Built-in example netlists, also test fixtures |
| `test.js` | `node --test`; uses `realworld/openram_1kb.sp` as a fixture |

Every module is a browser global **and** a Node module (`if (typeof module !== 'undefined') module.exports = …`).
Keep that dual shape: tests run the pipeline in Node without a browser.

## Commands

- `npm test` — the only automated check; keep it green.
- `npm run package` — builds the `.vsix`; `code|cursor --install-extension schematic-viewer-*.vsix --force` to install.
  Bump `version` in `package.json` first; `gh release create vX.Y.Z *.vsix` publishes it.

## Verify in the browser

`node --test` proves parsing, graph shape and row alignment, not what the schematic looks like. After changing `skin.js`, `xcouple.js`,
`tojson.js`, or `index.html` CSS, open `index.html` headless, render at least `nand2`, `sram6t`, `levelshifter`,
`powergate` and the OpenRAM `sense_amp` / `dp_cell`, and look at the screenshots. Element IDs in `index.html`
(`#tree #view #canvas #crumbs #detail #rails #warnings #file #example …`) are the contract `app.js` and the
extension rely on.

## Gotchas

- Rows are ours, the rest is ELK's: `layout.js: rows` puts VDD stubs on row 0, PMOS counted from VDD, NMOS counted
  from VSS, VSS stubs on the last row, and hands them to ELK as positions (`layering.strategy=INTERACTIVE`). Do not
  reach for ELK's `layerConstraint`/`priority.shortness` instead: its network-simplex layering re-balances nodes with
  equal in/out degree into the emptiest layer and ignores weights. Gate nets are drawn as text on the symbol and
  rails as per-pin stubs; reconnect either as a wire and stages collapse into one blob.
- `vendor/netlistsvg.bundle.js` has two marked one-line patches (`elkData` pass-through, `dumpLayout` export);
  re-apply them if the bundle is refreshed. `vendor/elk.bundled.js` is elkjs 0.9.3.
- Skin glyph widths (`s:width`) are laid out by ELK before text is measured; widening a label means widening the glyph.
- Supplies are per cell (`def.rails`), not global. A net can be a stub in one cell and a switched wire in its parent.
- The webview CSP needs `'unsafe-eval'`: the vendored netlistsvg bundle calls `Function()` at load.
- `MAX_INSTANCES` in `app.js` caps what is drawn; above it the cell shows an instance list.
- Mark deliberate ceilings with a `ponytail:` comment naming the upgrade path.
