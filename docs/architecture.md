# Architecture

```
netlist text ─▶ spice.js ─▶ {subckts, tops, globals, warnings}
                              │  computeRails: def.rails per cell
                              ▼
                 tojson.js ─▶ Yosys JSON + {bitNet, labelNet, wired, symbols, hasMos}
                   │  xcouple.js: cross-coupled cores become one generated glyph
                   ▼
   netlistsvg.render(skin.js + symbols, json) ─▶ SVG   (elkjs layered layout, direction DOWN)
                   ▼
                 app.js: decorate (data-net / data-inst), tree, breadcrumb, pan/zoom
```

Each stage is a pure function on plain objects and runs in Node (`test.js`) as well as the browser.

## Why the CMOS layout comes out right without a custom placer

netlistsvg lays out a Yosys module with ELK's layered algorithm. Three encoding choices make ELK produce the
textbook pull-up-over-pull-down picture:

1. **Rails are stubs, not nets.** Every VDD/VSS pin gets its own `vcc`/`gnd` cell (`s:type` in the skin) instead of
   joining a shared net. A shared rail net would tie every stage into one component.
2. **Gate nets are text.** A MOS gate is rendered as a label inside the symbol (`attributes.gate`), with no wire.
   Signal flow through the drawing is therefore only source→drain, and every stage (PUN + PDN meeting at an output)
   is a separate connected component that ELK stacks top-to-bottom: VDD stub → PMOS → output → NMOS → GND stub.
3. **Port sides.** PMOS: source on top, drain on bottom; NMOS: drain on top, source on bottom (`s:position` in
   `skin.js`). Series devices chain vertically; parallel devices share a net and land side by side.

Components are packed left→right, so stages read in signal order. Nets that are neither rails nor gates (outputs,
internal series nodes, pass-gate channels) are real wires; `app.js` writes their name on the longest segment.

### Source/drain orientation (`tojson.js: orient`)

SPICE `M d g s b` order is unreliable in extracted netlists. For each MOS type, `railDist` BFS-es from the rail
through same-type channels; the pin nearer its rail becomes the source. Nets with a finite distance are *driven*;
that also feeds `portDir` (driven or `^(z|y|q|out|o)` → output; child port directions propagate through `X`
instances) and decides which pins of a sub-circuit box are power pins (hidden when the net is a rail in the parent).

## Cross-coupled cores (`xcouple.js`)

Inverter pairs whose outputs drive each other's gates (bitcell, latch, sense amp, level-shifter PMOS pair) look
wrong as two independent stages. `XC.find` scans pairs of drain nets `A`, `B`: from each it walks a series chain
toward the rail (`chain`, at most `MAX_SERIES` devices, may end *open* at a dangling extraction net) and accepts the
pair when both sides are driven by the other's node. Devices touching `A`/`B` horizontally (pass gates, tgates) are
attached as `pass` columns; a device shared by both chains becomes a `tail` exposed as a port (sense-amp foot).
Parallel fingers with identical gate and far net are merged into one glyph labelled `X1,X2`.

`XC.symbol` emits a netlistsvg skin glyph (`s:type="xcN"`) drawn textbook style — two stacks facing each other,
feedback wires with hops, pass transistors on the outer sides — and `tojson.js` instantiates it as a single cell
whose only ports are nets something else wires to. The generated glyphs are appended to the skin per render.

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
- Embedded in VS Code (`acquireVsCodeApi` present): file controls hidden, document arrives via
  `postMessage({type:'load', text})` after the view posts `ready`.

## Known ceilings

- Wire-name labels do not avoid collisions.
- A device shared by two series chains on the same side is drawn twice.
- Cells above `MAX_INSTANCES` (400) show an instance list; ELK layout is superlinear and the drawing would be
  unreadable anyway.
- `.include`/`.lib` are recorded as warnings, never resolved.
