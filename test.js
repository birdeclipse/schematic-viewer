// node --test test.js
const test = require('node:test');
const assert = require('node:assert/strict');
global.SPICE = require('./spice.js');
global.XC = require('./xcouple.js');
global.ELK = require('./vendor/elk.bundled.js');
global.netlistsvg = require('./vendor/netlistsvg.bundle.js');
const toYosys = require('./tojson.js');
const LAYOUT = require('./layout.js');
const SKIN = require('./skin.js');
const EXAMPLES = require('./examples.js');

const parse = k => SPICE.parse(EXAMPLES[k]);
const cell = (nl, n) => nl.subckts[n.toLowerCase()];

test('parses M cards, params, rails, MOS type', () => {
  const nl = parse('nand2');
  const c = cell(nl, 'NAND2');
  assert.deepEqual(c.ports, ['A', 'B', 'Z', 'VDD', 'VSS']);
  assert.equal(c.instances.length, 4);
  assert.deepEqual(c.instances.map(i => i.type), ['pmos', 'pmos', 'nmos', 'nmos']);
  assert.deepEqual(c.instances[3].pins, ['n1', 'B', 'VSS', 'VSS']);
  assert.equal(c.instances[0].params.W, '0.2u');
  assert.equal(SPICE.rail('VDD'), 'vcc');
  assert.equal(SPICE.rail('VSS'), 'gnd');
  assert.equal(SPICE.rail('n1'), null);
  assert.deepEqual(nl.tops, ['NAND2']);
});

test('X-as-MOSFET, hierarchy, $PINS, .model, continuation, / params', () => {
  const sram = cell(parse('sram6t'), 'SRAM6T');
  assert.deepEqual(sram.instances.map(i => i.kind + i.type), ['Mpmos', 'Mpmos', 'Mnmos', 'Mnmos', 'Mnmos', 'Mnmos']);

  const nl = parse('mux4_hier');
  assert.deepEqual(nl.tops, ['MUX4']);
  const m2 = cell(nl, 'MUX2');
  assert.equal(m2.instances[0].kind, 'X');
  assert.equal(m2.instances[0].model, 'INV');
  assert.deepEqual(m2.instances[0].pins, ['S', 'SB', 'VDD', 'VSS']);

  const c = parse('cdl_pins');
  assert.deepEqual(cell(c, 'BUF').instances[0].pins, ['A', 'n', 'VDD', 'VSS']);
  assert.deepEqual(cell(c, 'INV').ports, ['A', 'Z', 'VDD', 'VSS']);
  assert.equal(cell(c, 'INV').params.W, '1u');
  assert.deepEqual(cell(c, 'INV').instances.map(i => i.type), ['pmos', 'nmos']);
  assert.equal(c.warnings.length, 0);
  assert.match(SPICE.parse('.include "tech.sp"\n.subckt X a b\n.ends').warnings[0], /not resolved/);
});

test('toYosys: rails become stubs, gates become labels, ports flagged', () => {
  const nl = parse('inv');
  const { json, bitNet, labelNet, hasMos, wired } = toYosys(cell(nl, 'INV'), nl);
  const cells = json.modules.INV.cells;
  assert.ok(hasMos);
  assert.equal(cells.MP0.type, 'pmos');
  assert.deepEqual(cells.MP0.port_directions, { S: 'input', D: 'output' });
  assert.deepEqual(cells.MN0.port_directions, { D: 'input', S: 'output' });
  // Z is the only wire shared by two devices; VDD/VSS/A are stubs with private bits.
  assert.deepEqual(wired, ['Z']);
  assert.equal(cells.MP0.connections.D[0], cells.MN0.connections.D[0]);
  assert.equal(cells.MP0.attributes.gate, 'A');
  const types = Object.values(cells).map(c => c.type).sort();
  assert.deepEqual(types, ['gnd', 'nmos', 'pmos', 'port_out', 'vcc']);
  assert.deepEqual(new Set(Object.values(labelNet)), new Set(['Z', 'VDD', 'VSS']));
  assert.equal(bitNet[cells.MP0.connections.D[0]], 'Z');
});

test('toYosys: hierarchical instance ports get directions from child cell', () => {
  const nl = parse('mux4_hier');
  const { json, hasMos } = toYosys(cell(nl, 'MUX4'), nl);
  assert.ok(!hasMos);
  const xm0 = json.modules.MUX4.cells.XM0;
  assert.equal(xm0.type, 'MUX2');
  assert.equal(xm0.port_directions.Z, 'output');
  assert.equal(xm0.port_directions.D0, 'input');
  assert.equal(xm0.port_directions.S, 'input');
});

test('cross-coupled cores: 6T cell, sense amp tail, DFF latches, level shifter', () => {
  const core = (nl, name) => {
    const def = nl.subckts[name.toLowerCase()];
    const c = toYosys(def, nl);
    const cells = c.json.modules[def.name].cells;
    const railPin = /^[PN]\d\d$/;                                   // rail chain ends: one pin each, stubs added by ELK
    const xcs = Object.entries(cells).filter(([k]) => k.startsWith('xc')).map(([, v]) => Object.keys(v.connections).sort());
    return { xc: xcs.map(ps => ps.filter(p => !railPin.test(p))), pins: xcs, symbols: c.symbols, rest: Object.keys(cells).filter(k => !k.startsWith('lbl') && !k.startsWith('xc')) };
  };
  const sram = core(parse('sram6t'), 'SRAM6T');
  assert.deepEqual(sram.xc, [[]]);                                 // BL/BLB ports drawn inside
  assert.deepEqual(sram.pins, [['N00', 'N10', 'P00', 'P10']]);     // one rail pin per chain end
  assert.match(sram.symbols[0], /class="flag" data-net="BLB"/);
  assert.deepEqual(sram.rest, []);
  assert.match(sram.symbols[0], /XPU0/);
  assert.match(sram.symbols[0], /data-net="WL"/);

  const ls = core(parse('levelshifter'), 'LS');
  assert.deepEqual(ls.xc, [[]]);                                   // OUT is a cell port drawn inline
  assert.deepEqual(ls.rest.sort(), ['MNI', 'MPI']);

  const fs = require('node:fs');
  const nl = SPICE.parse(fs.readFileSync(__dirname + '/realworld/openram_1kb.sp', 'utf8'));
  const sa = core(nl, 'sky130_fd_bd_sram__openram_sense_amp');
  assert.deepEqual(sa.xc, [['TN']]);                               // shared foot is a port; BL/BR flags inline
  assert.deepEqual(sa.rest.sort(), ['X1000', 'X1007', 'X1008']);   // foot transistor + output inverter
  const dff = core(nl, 'sky130_fd_bd_sram__openram_dff');
  assert.equal(dff.xc.length, 2);                                  // master and slave latches
  assert.deepEqual(dff.rest.sort(), ['X1007', 'X1008']);           // clock inverter
  const cell = core(nl, 'sky130_fd_bd_sram__openram_dp_cell');
  assert.deepEqual(cell.xc, [['L0', 'R0']]);                     // BL1/BR1 also feed the dummy devices; BL0/BR0 inline
  assert.match(cell.symbols[0], /class="flag" data-net="BL0"/);
  assert.match(cell.symbols[0], /X1,X2/);                          // parallel fingers merged
});

test('supply nets: names, hierarchy propagation, switch demotion, overrides', () => {
  const nl = parse('powergate');
  const rails = n => Object.fromEntries(nl.subckts[n].rails);
  // leaf uses PDK names; parent inherits them through the child power ports
  assert.deepEqual(rails('inv'), { VPWR: 'vcc', VGND: 'gnd' });
  assert.deepEqual(rails('domain'), { VDD: 'vcc', VSS: 'gnd', VIRT_PWR: 'vcc', VIRT_PWR2: 'vcc', VIRT_GND: 'gnd' });
  // in the switch cell itself the virtual rails are wires (reachable from VDD through PMOS channels)
  assert.deepEqual(rails('gated_inv'), { VDD: 'vcc', VSS: 'gnd' });
  assert.deepEqual(rails('header'), {});
  const g = toYosys(nl.subckts.gated_inv, nl);
  assert.deepEqual(g.wired.sort(), ['VVDD', 'VVVDD', 'Z']);
  // in DOMAIN the header's VOUT pin is not a power port of HEADER, so it stays wired to the VIRT_PWR stub
  const dcells = toYosys(nl.subckts.domain, nl).json.modules.DOMAIN.cells;
  assert.deepEqual(Object.keys(dcells.XH1.connections), ['SLEEP', 'VIN', 'VOUT']);
  assert.deepEqual(Object.keys(dcells.XI1.connections), ['A', 'Z']);
  // name patterns
  for (const n of ['VDD', 'AVDD', 'LVPWR', 'VVDD', 'VIRT_VDD', 'VDD_INT', 'vddq']) assert.equal(SPICE.rail(n), 'vcc', n);
  for (const n of ['VSS', 'GND', 'VGND', 'DVSS', 'VVSS', 'VIRT_GND', '0']) assert.equal(SPICE.rail(n), 'gnd', n);
  for (const n of ['BL', 'Q', 'a_56_432#', 'VOUT', 'VIN']) assert.equal(SPICE.rail(n), null, n);
  // user override: HEADER's VIN/VOUT become supplies; VOUT is then demoted (reachable from VIN)
  SPICE.setRailPatterns('^VIN$|^VOUT$', '');
  SPICE.computeRails(nl);
  assert.deepEqual(rails('header'), { VIN: 'vcc' });
  SPICE.setRailPatterns('', '');
});

test('parser edge cases: comments, continuations, sources, 3-pin M, .ENDS name, case, malformed', () => {
  const nl = SPICE.parse(`
* header comment
.SUBCKT   Mixed  in out vdd gnd
+ w=1u
M1 out in vdd pch W=w L=0.1u $ trailing CDL comment
M2 out in gnd nch // c-style comment
R1 out gnd 10k
C1 out gnd 1p m=2
V1 vdd gnd DC 1.8
I1 out gnd 1u
D1 out gnd dio area=2
Q1 out in gnd npn_model
Xsub1 in out vdd gnd / mixed
.ENDS Mixed
.subckt
.END
`);
  const c = nl.subckts.mixed;
  assert.equal(c.name, 'Mixed');
  assert.deepEqual(c.ports, ['in', 'out', 'vdd', 'gnd']);
  assert.equal(c.params.w, '1u');
  const by = Object.fromEntries(c.instances.map(i => [i.name, i]));
  assert.deepEqual(by.M1.pins, ['out', 'in', 'vdd']);             // 3-pin MOSFET keeps its model
  assert.equal(by.M1.model, 'pch');
  assert.equal(by.M1.type, 'pmos');
  assert.deepEqual([by.M2.model, by.M2.type], ['nch', 'nmos']);
  assert.deepEqual([by.R1.pins, by.R1.model], [['out', 'gnd'], '10k']);
  assert.deepEqual([by.C1.pins, by.C1.model, by.C1.params.m], [['out', 'gnd'], '1p', '2']);
  assert.deepEqual([by.V1.pins, by.V1.model], [['vdd', 'gnd'], 'DC']);
  assert.deepEqual([by.I1.pins, by.I1.model], [['out', 'gnd'], '1u']);
  assert.deepEqual([by.D1.pins, by.D1.model], [['out', 'gnd'], 'dio']);
  assert.deepEqual([by.Q1.pins, by.Q1.model], [['out', 'in', 'gnd'], 'npn_model']);
  assert.equal(by.Xsub1.kind, 'X');                                 // self reference resolves case-insensitively
  assert.ok(nl.warnings.some(w => /without a name/.test(w)));
  assert.equal(nl.warnings.length, 1);
});

test('MOS type: .model wins over name heuristics; unknown models warn and default to nmos', () => {
  const nl = SPICE.parse(`
.MODEL weird_p NMOS
.SUBCKT T a z vdd vss
M1 z a vdd vdd weird_p
M2 z a vss vss sky130_fd_pr__nfet_01v8_lvt
M3 z a vss vss mystery
X4 z a vdd vdd pfet_hvt W=1
.ENDS`);
  const t = Object.fromEntries(nl.subckts.t.instances.map(i => [i.name, i]));
  assert.equal(t.M1.type, 'nmos');                                  // .model declares it NMOS despite the p
  assert.equal(t.M2.type, 'nmos');
  assert.equal(t.M3.type, 'nmos');
  assert.deepEqual([t.X4.kind, t.X4.type], ['M', 'pmos']);          // X card that names a MOS model
  assert.ok(nl.warnings.some(w => /mystery/.test(w)));
  assert.deepEqual(nl.tops, ['T']);
});

test('orientation: source faces the rail regardless of netlist D/S order', () => {
  const nl = SPICE.parse(`
.SUBCKT NAND2R A B Z VDD VSS
MP0 VDD A Z VDD pch
MP1 Z B VDD VDD pch
MN0 n1 A Z VSS nch
MN1 VSS B n1 VSS nch
.ENDS`);
  const cells = toYosys(nl.subckts.nand2r, nl).json.modules.NAND2R.cells;
  const net = (c, pin) => Object.values(cells).find(x => x.attributes?.name && x.connections.A[0] === c.connections[pin][0])?.attributes.name;
  assert.equal(net(cells.MP0, 'S'), 'VDD');                         // swapped: VDD was listed as drain
  assert.equal(net(cells.MN1, 'S'), 'VSS');
  // series stack: MN0.S and MN1.D share the internal wire n1
  assert.equal(cells.MN0.connections.S[0], cells.MN1.connections.D[0]);
  assert.equal(cells.MN0.connections.D[0], cells.MP0.connections.D[0]);
});

test('orientation: pass devices put the signal source on top, so a tgate pair agrees', () => {
  const nl = SPICE.parse(`
.SUBCKT TG D0 S SB Z VDD VSS
MP0 D0 SB Z VDD pch
MN0 Z S D0 VSS nch
MP1 n1 SB Z VDD pch
MN1 Z S n1 VSS nch
.ENDS`);
  const cells = toYosys(nl.subckts.tg, nl).json.modules.TG.cells;
  const top = c => c.type === 'pmos' ? c.connections.S[0] : c.connections.D[0];
  assert.equal(top(cells.MP0), top(cells.MN0));                     // both show D0 on top
  const port = Object.values(cells).find(c => c.type === 'port_in' && c.attributes.name === 'D0');
  assert.equal(top(cells.MP0), port.connections.A[0]);
  assert.equal(top(cells.MP1), top(cells.MN1));                     // internal n1 over output port Z
  assert.notEqual(top(cells.MP1), Object.values(cells).find(c => c.type === 'port_out').connections.A[0]);
});

// Full pipeline through ELK: supplies line up across stages, PMOS under VDD, NMOS over VSS.
const layout = async (key, name, moved) => {
  const nl = SPICE.parse(EXAMPLES[key]);
  const conv = toYosys(cell(nl, name), nl);
  const skin = conv.symbols.length ? SKIN.replace('</svg>', conv.symbols.join('') + '</svg>') : SKIN;
  const out = await LAYOUT.render(skin, conv, moved);
  const cells = conv.json.modules[out.name].cells;
  const nodes = Object.fromEntries(out.graph.children.map(n => [n.id, { ...n, type: cells[n.id]?.type }]));
  const ys = t => new Set(Object.values(nodes).filter(n => n.type === t).map(n => n.y));
  return { out, nodes, ys };
};

test('layout: every VDD stub shares one row and every VSS stub another; devices hug their rail', async () => {
  for (const [key, name] of [['aoi21', 'AOI21'], ['levelshifter', 'LS'], ['powergate', 'GATED_INV'], ['sram6t', 'SRAM6T']]) {
    const { nodes, ys } = await layout(key, name);
    assert.equal(ys('vcc').size, 1, `${name}: VDD rows`);
    assert.equal(ys('gnd').size, 1, `${name}: VSS rows`);
    assert.ok([...ys('vcc')][0] < [...ys('gnd')][0], `${name}: VDD above VSS`);
  }
  const { nodes } = await layout('aoi21', 'AOI21');
  assert.equal(nodes.MP0.y, nodes.MP1.y);                            // parallel PMOS on one row
  assert.equal(nodes.MN2.y, nodes.MN1.y);                            // lone NMOS drops to the stack's last row
  assert.ok(nodes.MN2.y > nodes.MN0.y);
  assert.ok(nodes.MN1.y > nodes.MN0.y && nodes.MP2.y > nodes.MP0.y);  // series order preserved
  assert.match(nodes.MP0.layoutOptions['org.eclipse.elk.alignment'], /TOP/);
  assert.match(nodes.MN0.layoutOptions['org.eclipse.elk.alignment'], /BOTTOM/);
});

test('layout: moving a node re-lays out in the new order with its rail stub, rails still aligned', async () => {
  const first = await layout('aoi21', 'AOI21');
  assert.ok(first.nodes.MN2.x > first.nodes.MN0.x);
  const second = await layout('aoi21', 'AOI21', { graph: first.out.graph, id: 'MN2', dx: -400, dy: 0 });
  assert.ok(second.nodes.MN2.x < second.nodes.MN0.x, 'MN2 moved left of the stack');
  assert.equal(second.ys('gnd').size, 1);
  assert.equal(second.ys('vcc').size, 1);
  const stub = Object.values(second.nodes).find(n => n.type === 'gnd' && n.x < second.nodes.MN0.x);
  assert.ok(stub, 'a VSS stub followed MN2');
  assert.ok(second.out.svg.includes('cell_MN2'));
});

test('port directions and labels: driven nets are outputs, pass-gate nets fall back to names', () => {
  const nl = SPICE.parse(EXAMPLES.mux2_tgate + EXAMPLES.nand2);
  const mux = toYosys(nl.subckts.mux2, nl);
  const types = Object.values(mux.json.modules.MUX2.cells).filter(c => c.type.startsWith('port')).map(c => `${c.attributes.name}:${c.type}`).sort();
  assert.deepEqual(types, ['D0:port_in', 'D1:port_in', 'Z:port_out']);          // S only drives gates: drawn as gate text, no flag
  assert.ok(mux.wired.includes('SB'));                               // internal net gets a wire label
  const nand = toYosys(nl.subckts.nand2, nl);
  assert.deepEqual(nand.wired.sort(), ['Z', 'n1']);
});

test('sub-circuit boxes: pins, directions, power-port hiding, unresolved child', () => {
  const nl = SPICE.parse(`
.SUBCKT INV A Z VDD VSS
MP Z A VDD VDD pch
MN Z A VSS VSS nch
.ENDS
.SUBCKT BUF2 A Z VDD VSS EN
XI0 A n VDD VSS / INV
XI1 n Z VDD VSS / INV
XU n EN VDD / unknown_cell
.ENDS`);
  const cells = toYosys(nl.subckts.buf2, nl).json.modules.BUF2.cells;
  assert.deepEqual(Object.keys(cells.XI0.connections), ['A', 'Z']);   // VDD/VSS hidden on the box
  assert.deepEqual(cells.XI0.port_directions, { A: 'input', Z: 'output' });
  assert.deepEqual(Object.keys(cells.XU.connections), ['p0', 'p1', 'p2']);  // unknown child: positional names, VDD pin kept (not known to be a power port)
  assert.ok(nl.warnings.some(w => /unknown_cell/.test(w)));
});

test('cross-coupled cores: no false positives on inverter chains; open-ended and shared-foot chains', () => {
  const rail = n => SPICE.rail(n);
  const mos = (i, d, g, s, type) => ({ i, d, g, s, type, model: type, value: '' });
  // inverter chain a->b->c is not cross-coupled
  assert.deepEqual(XC.find([mos('P1', 'b', 'a', 'VDD', 'pmos'), mos('N1', 'b', 'a', 'VSS', 'nmos'), mos('P2', 'c', 'b', 'VDD', 'pmos'), mos('N2', 'c', 'b', 'VSS', 'nmos')], rail), []);
  // plain latch
  const latch = XC.find([mos('P1', 'q', 'qb', 'VDD', 'pmos'), mos('N1', 'q', 'qb', 'VSS', 'nmos'), mos('P2', 'qb', 'q', 'VDD', 'pmos'), mos('N2', 'qb', 'q', 'VSS', 'nmos')], rail);
  assert.equal(latch.length, 1);
  assert.deepEqual(latch[0].devices.map(m => m.i).sort(), ['N1', 'N2', 'P1', 'P2']);
  // shared foot -> tail, foot device left out of the cluster
  const sa = XC.find([mos('P1', 'q', 'qb', 'VDD', 'pmos'), mos('N1', 'q', 'qb', 't', 'nmos'), mos('P2', 'qb', 'q', 'VDD', 'pmos'), mos('N2', 'qb', 'q', 't', 'nmos'), mos('NF', 't', 'EN', 'VSS', 'nmos')], rail);
  assert.equal(sa[0].tail.nmos, 't');
  assert.ok(!sa[0].devices.some(m => m.i === 'NF'));
  // dangling source (extraction artefact) still forms a core; rail and open chain ends are pins
  const open = XC.find([mos('P1', 'q', 'qb', 'VDD', 'pmos'), mos('P2', 'qb', 'q', 'float', 'pmos'), mos('N1', 'q', 'A', 'VSS', 'nmos'), mos('N2', 'qb', 'B', 'VSS', 'nmos')], rail);
  assert.equal(open.length, 1);
  const sym = XC.symbol(open[0], 'xc0', {}, () => null, rail);
  assert.match(sym.svg, />A</);                                      // independent gate label
  assert.deepEqual(sym.pins.map(p => [p.net, p.position, p.y]).sort(), [['VDD', 'top', 0], ['VSS', 'bottom', sym.H], ['VSS', 'bottom', sym.H], ['float', 'top', 0]]);
  assert.ok(!/VDD/.test(sym.svg.replace(/data-net="[^"]*"/g, '')), 'no inline rail symbol');
});

test('rails: .global nets, clocks used as gates, nested switch demotion, override precedence', () => {
  const nl = SPICE.parse(`
.GLOBAL VPP CLKG
.SUBCKT C A Z VPP CLKG
MP Z A VPP VPP pch
MN Z CLKG VSS_LOCAL VSS_LOCAL nch
.ENDS
.SUBCKT SW VDD OUT2 EN
MS1 VVDD EN VDD VDD pch
MS2 OUT2 EN VVDD VVDD pch
.ENDS`);
  assert.deepEqual(Object.fromEntries(nl.subckts.c.rails), { VPP: 'vcc', VSS_LOCAL: 'gnd' });   // CLKG is a gate: not a rail
  assert.deepEqual(Object.fromEntries(nl.subckts.sw.rails), { VDD: 'vcc' });                    // VVDD and OUT2 demoted
  SPICE.setRailPatterns('OUT2', 'CLKG');
  SPICE.computeRails(nl);
  assert.equal(nl.subckts.c.rails.get('CLKG'), 'gnd');              // explicit user name wins even on a gate net
  assert.equal(nl.subckts.sw.rails.get('OUT2'), undefined);         // but a switched supply stays a wire in the switch cell
  SPICE.setRailPatterns('', '');
  SPICE.computeRails(nl);
  assert.equal(nl.subckts.c.rails.get('CLKG'), undefined);
});

test('OpenRAM decoder path renders as stages: NAND4 stack, predecoder boxes, no clusters', () => {
  const fs = require('node:fs');
  const nl = SPICE.parse(fs.readFileSync(__dirname + '/realworld/openram_1kb.sp', 'utf8'));
  assert.equal(Object.keys(nl.subckts).length, 93);
  assert.equal(nl.warnings.length, 0);
  const nand4 = toYosys(nl.subckts.sky130_fd_bd_sram__openram_dp_nand4_dec, nl);
  assert.equal(nand4.symbols.length, 0);
  const cells = nand4.json.modules.sky130_fd_bd_sram__openram_dp_nand4_dec.cells;
  const nmos = Object.values(cells).filter(c => c.type === 'nmos'), pmos = Object.values(cells).filter(c => c.type === 'pmos');
  assert.equal(pmos.length, 4);
  assert.equal(nmos.length, 4);
  assert.equal(new Set(pmos.map(c => c.connections.D[0])).size, 1);                    // parallel: all drains on Z
  assert.equal(nmos.filter(c => Object.values(cells).some(o => o !== c && o.type === 'nmos' && o.connections.D[0] === c.connections.S[0])).length, 3); // series chain
  const pre = toYosys(nl.subckts.hierarchical_predecode2x4, nl);
  assert.ok(!pre.hasMos);
  assert.ok(Object.values(pre.json.modules.hierarchical_predecode2x4.cells).every(c => !('vdd' in c.connections) && !('gnd' in c.connections)));
  assert.equal(nl.subckts.bitcell_array.instances.length, 8192);
});
