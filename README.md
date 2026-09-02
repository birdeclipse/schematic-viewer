# SPICE Schematic Viewer

Draws SPICE / CDL / HSPICE netlists (`.spi .sp .cdl .cir .spice .ckt .net`) as CMOS schematics:
PMOS pull-up network above the NMOS pull-down network, one column per stage, gate nets and rails as labels,
sub-circuits as pin boxes with double-click descend and breadcrumb navigation.
SRAM bitcells, sense amps, latches/DFFs and level shifters are detected structurally and drawn textbook style.

## Use in a browser

Open `index.html` — no build, no server. Open/drop a netlist or pick an example.

## Use in VS Code / Cursor

```
npm install
npm run package                              # -> schematic-viewer-<version>.vsix
code   --install-extension schematic-viewer-*.vsix
cursor --install-extension schematic-viewer-*.vsix
```

Open a netlist, then click the circuit-board icon in the editor title, run **Schematic Viewer: Open as Schematic**,
or right-click the file → *Open With…* → *Schematic Viewer*. The view follows edits to the document.

Header controls: **Power** / **Ground** name lists (`VDD* VPWR`, `*` wildcard) override supply detection,
`⏚` shows which nets the current cell treats as supplies, search jumps to a net or device, `f` fits to window.

## Tests

```
npm test
```

Layout uses [netlistsvg](https://github.com/nturley/netlistsvg) and [elkjs](https://github.com/kieler/elkjs) (MIT, vendored).
Fixtures under `realworld/` are from [OpenRAM](https://github.com/VLSIDA/OpenRAM) (BSD-3) and the
[SkyWater PDK](https://github.com/google/skywater-pdk) (Apache-2.0).
