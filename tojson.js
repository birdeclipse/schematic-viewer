// Subckt -> Yosys JSON for netlistsvg. Rails become per-pin vcc/gnd stubs and MOS gates are
// drawn as text on the symbol (no wire), so every CMOS stage is its own connected component:
// PUN on top, PDN below, stages side by side. Returns {json, bitNet, labelNet, hasMos}.
const toYosys = (() => {
  const PASSIVE = { R: 'r_v', C: 'c_v', L: 'l_v', D: 'd_v' };
  const PASSIVE_PINS = { R: ['A', 'B'], C: ['A', 'B'], L: ['A', 'B'], D: ['+', '-'] };
  const OUT_RE = /^(z|y|q|out|o)/i;

  function paramText(p) {
    return ['W', 'L', 'nfin', 'nf', 'm', 'M'].filter(k => k in p).map(k => `${k}=${p[k]}`).join(' ');
  }

  // Per MOS type: hop distance of every net from its rail through same-type channels
  // (VDD via PMOS, VSS via NMOS). Nets with a finite distance are actively driven; pass gates
  // and tgates never reach a rail. Also used to orient S/D so the source faces the rail.
  // ponytail: SRAM bitlines come out "driven" via the pass gate; acceptable for a bitcell.
  const railOf = (def, n) => def.rails.get(n) || null;
  const distCache = new WeakMap();                 // keyed by def.rails so recomputed rails invalidate
  function railDist(def) {
    if (distCache.has(def.rails)) return distCache.get(def.rails);
    const dist = { pmos: {}, nmos: {} };
    for (const type of ['pmos', 'nmos']) {
      const adj = {};
      for (const i of def.instances) if (i.kind === 'M' && i.type === type) {
        const [d, , s] = i.pins;
        (adj[d] ??= []).push(s);
        (adj[s] ??= []).push(d);
      }
      const d = dist[type];
      const queue = Object.keys(adj).filter(n => railOf(def, n) === (type === 'pmos' ? 'vcc' : 'gnd'));
      for (const n of queue) d[n] = 0;
      for (let k = 0; k < queue.length; k++) for (const n of adj[queue[k]] || []) if (!(n in d)) { d[n] = d[queue[k]] + 1; queue.push(n); }
    }
    distCache.set(def.rails, dist);
    return dist;
  }
  const isDriven = (def, net) => !railOf(def, net) && (net in railDist(def).pmos || net in railDist(def).nmos);
  // Netlist D/G/S order, with D and S swapped when the drain is nearer the rail than the source.
  function orient(def, i) {
    const [d, g, s] = i.pins;
    const dd = railDist(def)[i.type];
    return d in dd && s in dd && dd[d] < dd[s] ? [s, g, d] : [d, g, s];
  }

  const dirCache = new WeakMap();
  function portDir(net, def, netlist, seen = new Set()) {
    const cache = dirCache.get(def.rails) ?? dirCache.set(def.rails, new Map()).get(def.rails);
    if (cache.has(net)) return cache.get(net);
    const key = def.name + '|' + net;
    if (seen.has(key) || railOf(def, net)) return 'input';
    seen.add(key);
    let dir = isDriven(def, net) || OUT_RE.test(net) ? 'output' : 'input';
    for (const i of def.instances) if (i.kind === 'X') {
      const child = netlist.subckts[i.model.toLowerCase()];
      if (child) i.pins.forEach((n, k) => {
        if (n === net && child.ports[k] && portDir(child.ports[k], child, netlist, seen) === 'output') dir = 'output';
      });
    }
    cache.set(net, dir);
    return dir;
  }

  function convert(def, netlist) {
    let nextBit = 1;
    const bitNet = {};        // bit -> net name
    const shared = {};        // net -> bit used by wired endpoints
    const endpoints = {};     // net -> count of wired endpoints
    const labelNet = {};      // label cell key -> net
    const cells = {};
    let hasMos = false, nLabel = 0;
    const fresh = net => { bitNet[nextBit] = net; return nextBit++; };
    const wire = net => { endpoints[net] = (endpoints[net] || 0) + 1; return shared[net] ??= fresh(net); };
    const label = (net, type, attrs = {}) => {
      const key = `lbl${nLabel++}`;
      labelNet[key] = net;
      cells[key] = { type, connections: { A: [0] }, port_directions: { A: 'input' }, attributes: { name: net, ...attrs } };
      return cells[key];
    };
    // Rail pin -> its own stub cell. Otherwise -> shared wire bit.
    const rail = net => railOf(def, net);
    const pinBit = net => {
      const r = rail(net);
      if (!r) return wire(net);
      const b = fresh(net);
      label(net, r).connections.A = [b];
      return b;
    };

    const mos = def.instances.filter(i => i.kind === 'M').map(i => {
      const [d, g, s] = orient(def, i);
      return { i: i.name, d, g, s, type: i.type, model: i.model.replace(/^.*__/, ''), value: paramText(i.params) };
    });
    const mosOf = Object.fromEntries(mos.map(m => [m.i, m]));
    const clusters = XC.find(mos, rail);
    const clustered = new Set(clusters.flatMap(c => c.devices.map(m => m.i)));

    for (const i of def.instances) {
      if (clustered.has(i.name)) continue;
      if (i.kind === 'M') {
        hasMos = true;
        const m = mosOf[i.name];
        cells[i.name] = {
          type: i.type,
          connections: { D: [pinBit(m.d)], S: [pinBit(m.s)] },
          port_directions: i.type === 'pmos' ? { S: 'input', D: 'output' } : { D: 'input', S: 'output' },
          attributes: { gate: m.g, model: m.model, value: m.value },
        };
      } else if (i.kind === 'X') {
        const child = netlist.subckts[i.model.toLowerCase()];
        const names = child ? child.ports : i.pins.map((_, k) => 'p' + k);
        const connections = {}, port_directions = {};
        i.pins.forEach((net, k) => {
          const pn = names[k] || 'p' + k;
          if (rail(net) && child?.rails.has(pn)) return;  // power pin on a power port: implicit on the symbol
          connections[pn] = [pinBit(net)];
          port_directions[pn] = child ? portDir(pn, child, netlist) : 'input';
        });
        cells[i.name] = { type: i.model, connections, port_directions, attributes: { name: i.name, value: paramText(i.params) } };
      } else {
        const type = PASSIVE[i.kind];
        const pn = PASSIVE_PINS[i.kind] || i.pins.map((_, k) => 'p' + k);
        const connections = {}, port_directions = {};
        i.pins.forEach((net, k) => { connections[pn[k]] = [pinBit(net)]; port_directions[pn[k]] = k === 0 ? 'input' : 'output'; });
        cells[i.name] = { type: type || i.model || i.kind, connections, port_directions, attributes: { name: i.name, value: i.model } };
      }
    }

    // Cross-coupled cores: one generated textbook glyph each. Node ports only if something else wires to them.
    const symbols = [];
    const use = {};                                    // net -> wired endpoints outside cluster cores
    const bump = n => { use[n] = (use[n] || 0) + 1; };
    for (const i of def.instances) if (!clustered.has(i.name)) (i.kind === 'M' ? [mosOf[i.name].d, mosOf[i.name].s] : i.pins).forEach(bump);
    for (const c of clusters) { [...c.pass[c.A], ...c.pass[c.B]].forEach(m => bump(m.other)); Object.values(c.tail).forEach(bump); }
    const portOf = net => (def.ports.includes(net) ? (portDir(net, def, netlist) === 'output' ? 'out' : 'in') : null);
    clusters.forEach((c, k) => {
      hasMos = true;
      const id = `xc${k}`;
      const sym = XC.symbol(c, id, use, portOf, rail);
      symbols.push(sym.svg);
      const connections = {}, port_directions = {};
      for (const p of sym.pins) { connections[p.pid] = [pinBit(p.net)]; port_directions[p.pid] = p.pid === 'TN' ? 'output' : 'input'; }
      cells[id] = { type: id, connections, port_directions, attributes: {} };
    });

    // Ports of this cell get an I/O flag; other nets with a single wired endpoint get a plain label.
    const portSet = new Set(def.ports);
    for (const net of Object.keys(shared)) {
      if (portSet.has(net)) {
        label(net, portDir(net, def, netlist) === 'output' ? 'port_out' : 'port_in').connections.A = [shared[net]];
      } else if (endpoints[net] === 1) {
        label(net, 'netlabel_l').connections.A = [shared[net]];
      }
    }
    const json = { modules: { [def.name]: { ports: {}, cells } } };
    return { json, bitNet, labelNet, hasMos, symbols, wired: Object.keys(shared).filter(n => endpoints[n] > 1) };
  }
  return convert;
})();
if (typeof module !== 'undefined') module.exports = toYosys;
