# Netlist support

What `spice.js` reads, how devices are classified, and what ends up drawn. Everything is case-insensitive.

## Syntax

| Construct | Handling |
|---|---|
| `*` line comments, `$ …` and `// …` trailing comments | stripped (`$PINS` is not a comment) |
| `+` continuation lines | joined |
| `k = v`, `k= v` | normalised to `k=v`; parentheses removed |
| `.SUBCKT name pins… [/ params] [k=v …]` | cell definition; `.ENDS [name]` closes it |
| `.GLOBAL nets…` | recorded; feeds supply detection |
| `.MODEL name pmos\|nmos …` | model type, wins over name heuristics |
| `.INCLUDE` `.INC` `.LIB` | warning only; drop the referenced file into the viewer too |
| `.PARAM .OPTION .END .TEMP …` | ignored |
| Elements outside any `.SUBCKT` | collected into a synthetic `(top)` cell |

## Element cards

| Card | Pins | Model / value |
|---|---|---|
| `Mname d g s [b] model [k=v …]` | 3 or 4 | last bare token |
| `Xname pins… [/] cell [k=v …] [$PINS a=n …]` | positional, or by `$PINS` name mapped onto the cell's ports | token after `/`, else last bare token |
| `Qname c b e [s] model`, `Dname a k model`, `Jname …` | all but last | last bare token |
| `R C L V I E G H F B name a b value…` | first two | third token (value or model); the rest ignored |

`X` instances whose model is not a defined cell but classifies as a MOSFET (CDL foundry style, e.g.
`X1 d g s b pch W=…`) are treated as `M` devices. Unresolved `X` models produce a warning and a box with positional pin names.

## MOS type

1. `.MODEL name pmos|nmos`
2. Model name matches `^p|pmos|pfet|pch|_p_|pHVT|pLVT` → PMOS, else `^n|nmos|nfet|nch|_n_` → NMOS
   (`sky130_fd_pr__pfet_01v8`, `pch_lvt`, `nfet_g5v0d10v5` all resolve).
3. Otherwise NMOS plus a warning.

Symbol label: instance name, model with the `lib__` prefix stripped, and `W L nfin nf m M` params when present
(`W/L` toggle hides them).

## Supplies

Which nets become rail stubs is decided per cell — see *Supply resolution* in `architecture.md`. From the user's
side:

- Built-in names: `VDD VCC VPWR` and `VSS GND VGND VEE 0`, with optional `L/H/A/D` prefix, `V` prefix, or `_`
  separator (`LVPWR`, `AVDD`, `VVDD`, `VIRT_GND`, `VDD_INT`).
- **Power / Ground** fields in the toolbar: whole-name globs (`VDD* VPWR virt_pwr2`), space or comma separated,
  persisted in `localStorage`. They take precedence over the built-in names.
- The `⏚` readout shows the nets the current cell treats as power / ground.
- Anything feeding a child cell's power port is recognised in the parent automatically, whatever it is called.

## Hierarchy

Top cells are those never instantiated. The tree groups children by sub-circuit; a cell above 400 instances is
listed instead of drawn. Cells are matched by lower-cased name, so `INV` and `inv` are the same cell.

## Dialects tested

HSPICE/CDL foundry style (`/` params, `$PINS`, `X`-as-MOSFET), OpenRAM sky130 output, SkyWater PDK cell netlists,
generic `.model`-based SPICE. Spectre syntax is not supported.
