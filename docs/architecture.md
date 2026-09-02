# Architecture

```
netlist text ─▶ spice.js ─▶ {subckts, tops, globals, warnings}
                              │  computeRails: def.rails per cell
                              ▼
                 tojson.js ─▶ Yosys JSON + {bitNet, labelNet, wired, symbols, hasMos}
                   │  xcouple.js: cross-coupled cores become one generated glyph
                   ▼
                 layout.js ─▶ netlistsvg.dumpLayout (ELK graph) ─▶ rows() ─▶ ELK ─▶ netlistsvg.render(elkData) ─▶ SVG
                   ▼
                 app.js: decorate (data-net / data-inst), tree, breadcrumb, pan/zoom, drag to place
```

Each stage is a pure function on plain objects and runs in Node (`test.js`) as well as the browser.

## Why the CMOS layout comes out right

netlistsvg turns the Yosys module into an ELK graph; `layout.js` assigns the rows (ELK layers) itself and lets
ELK's layered algorithm order, place and route. Four encoding choices make the textbook pull-up-over-pull-down
picture:

1. **Rails are stubs, not nets.** Every VDD/VSS pin gets its own `vcc`/`gnd` cell (`s:type` in the skin) instead of
   joining a shared net. A shared rail net would tie every stage into one blob.
2. **Gate nets are text.** A MOS gate is rendered as a label inside the symbol (`attributes.gate`), with no wire.
   Signal flow through the drawing is therefore only source→drain: VDD stub → PMOS → output → NMOS → GND stub.
3. **Port sides.** PMOS: source on top, drain on bottom; NMOS: drain on top, source on bottom (`s:position` in
   `skin.js`). Series devices chain vertically; parallel devices share a net and land side by side.
4. **One shared row structure** (`layout.js: rows`). The whole cell is one layering (no per-component packing):
   longest path from the sources puts VDD stubs on row 0 and PMOS chains counted down from VDD; NMOS, VSS
   stubs and input flags are then pushed as far down as their consumers allow, so NMOS chains are counted up
   from VSS and every VSS stub shares the last row. Rows are handed to ELK as node y-coordinates with
   `layering.strategy=INTERACTIVE`; PMOS get `alignment=TOP`, NMOS `alignment=BOTTOM` inside their row.
   ELK's own network-simplex layering cannot be steered here: after solving, it *balances* every node with
   equal in/out edge count into the emptiest feasible layer regardless of edge weights, which floats a lone
   NMOS up to the output row.

Left-to-right order is ELK's crossing minimisation with netlist order as the tie-breaker
(`considerModelOrder=NODES_AND_EDGES`), so stages come out as written. Nets that are neither rails nor gates
(outputs, internal series nodes, pass-gate channels) are real wires; `app.js` writes their name on the longest
segment.

### Drag to place (`app.js: grab`, `layout.js: render(…, moved)`)

Left-drag on any laid-out node moves its group plus the rail stubs hanging off its pins (`LAYOUT.withStubs`).
Each wire leaving a moving port is traced through the top-level `<line>`s until a junction circle, a foreign
port or a fork, then redrawn as an orthogonal L/Z from the new port position to that anchor (start axis from the
port side, end axis from the last original segment). Wires between two moving ports translate as they are. Net
names are re-placed on the longest segment. The dropped positions are written back into the kept ELK graph.

Shift-drop re-runs ELK instead: every node seeded at its current position, the moved set offset by the drag, and
INTERACTIVE cycle breaking / layering / crossing minimisation / node placement, so rows, order and x follow the
drop and the wires are recomputed by ELK. Positions are not persisted; navigating to another cell re-lays out
from scratch.

### Vendored netlistsvg patches

`vendor/netlistsvg.bundle.js` is upstream plus two marked lines: the public `render` forwards `elkData` and
exports `dumpLayout` (so `layout.js` can run ELK itself), and the `elkData` path resolves the SVG instead of
`undefined`. `vendor/elk.bundled.js` is elkjs 0.9.3 (upstream netlistsvg ships an older ELK without
`considerModelOrder`).

### Source/drain orientation (`tojson.js: orient`)

SPICE `M d g s b` order is unreliable in extracted netlists. For each MOS type, `railDist` BFS-es from the rail
through same-type channels; the pin nearer its rail becomes the source. Pass devices never reach a rail: there
the signal source (input port, or a net some stage drives) takes the top terminal and the output-ish net
(`^(z|y|q|out|o)` or output port) the bottom, so both halves of a tgate agree. Nets with a finite distance are
*driven*; that also feeds `portDir` (driven or `^(z|y|q|out|o)` → output; child port directions propagate
through `X` instances) and decides which pins of a sub-circuit box are power pins (hidden when the net is a
rail in the parent).

## Cross-coupled cores (`xcouple.js`)

Inverter pairs whose outputs drive each other's gates (bitcell, latch, sense amp, level-shifter PMOS pair) look
wrong as two independent stages. `XC.find` scans pairs of drain nets `A`, `B`: from each it walks a series chain
toward the rail (`chain`, at most `MAX_SERIES` devices, may end *open* at a dangling extraction net) and accepts the
pair when both sides are driven by the other's node. Devices touching `A`/`B` horizontally (pass gates, tgates) are
attached as `pass` columns; a device shared by both chains becomes a `tail` exposed as a port (sense-amp foot).
Parallel fingers with identical gate and far net are merged into one glyph labelled `X1,X2`.

`XC.symbol` emits a netlistsvg skin glyph (`s:type="xcN"`) drawn textbook style — two stacks facing each other,
feedback wires with hops, pass transistors on the outer sides — and `tojson.js` instantiates it as a single cell
whose ports are the nets something else wires to plus one pin per chain end (`P<side><col>` on top, `N<side><col>`
at the bottom), so its supplies are ordinary stubs on the shared VDD/VSS rows. The generated glyphs are appended
to the skin per render.

## Supply resolution (`spice.js: computeRails`)

`def.rails` is a `Map net → 'vcc'|'gnd'` computed per cell, in this order:

1. **Names**: user Power/Ground lists (`setRailPatterns`, anchored, `*` wildcard) win; then built-in
   `(^[lhad]?|_)v?(vdd|vcc|vpwr)` / `…(vss|gnd|vgnd|vee)|^0$`.
2. **`.global` nets** that are never a gate, polarity by the majority MOS type on their channels.
3. **Hierarchy propagation**: a parent net wired to a child *power port* (a port that is a rail inside the child)
   is a candidate in the parent. This is how `VIRT_PWR2` gets recognised without a naming rule.
4. **Demotion**: a candidate reachable from a stronger same-polarity candidate through same-type channels
   (header PMOS / footer NMOS, transitively) becomes a wire in that cell. Strength: `.global` > cell port >
   internal, then shorter name. A power-switch cell therefore shows the switch; the cells it feeds show a stub.

Leaf cells with non-standard supply names and no `.global` are indistinguishable from pass-gate cells; the
Power/Ground fields exist for them.

## UI (`app.js`)

- Tree: children grouped by sub-circuit (`Xbit_r0_c0… ×8192`), expanded lazily on `<details>` toggle.
- `decorate` tags wires/labels/stubs with `data-net` and device groups with `data-inst` so hover/click highlight
  and search are pure DOM class toggles. Double-click on a `.hier` box descends; breadcrumb ascends.
- Pan/zoom is one CSS transform on `#view`; the grid is a `background-image` on `#canvas` whose size/position are
  updated from the same transform, so it stays anchored to schematic coordinates.
- Left-drag on a `g[id^="cell_"]` moves that node (`grab`), anywhere else pans; `scene` keeps the last ELK graph
  so wires can be traced from port positions and a Shift-drop can re-lay out around it (`draw(moved)`).
- Embedded in VS Code (`acquireVsCodeApi` present): file controls hidden, document arrives via
  `postMessage({type:'load', text})` after the view posts `ready`.

## Known ceilings

- Wire-name labels do not avoid collisions.
- A device shared by two series chains on the same side is drawn twice.
- Custom placements live only in the drawn cell: leaving and returning re-lays out from scratch.
- Hand-routed wires (after a drag) are L/Z only: they do not avoid other devices or wires.
- A tall cross-coupled glyph sets the height of its row, so a plain inverter beside a sense amp is stretched
  between the shared VDD and VSS rows.
- Cells above `MAX_INSTANCES` (400) show an instance list; ELK layout is superlinear and the drawing would be
  unreadable anyway.
- `.include`/`.lib` are recorded as warnings, never resolved.
