// SPICE / CDL / HSPICE netlist parser. Plain script (browser global SPICE) + node module.
const SPICE = (() => {
  const PMOS_RE = /^p|pmos|pfet|pch|_p_/i;
  const NMOS_RE = /^n|nmos|nfet|nch|_n_/i;
  const VDD_RE = /(^[lhad]?|_)v?(vdd|vcc|vpwr)/i;          // VDD AVDD LVPWR VVDD VIRT_VDD VDD_INT
  const VSS_RE = /(^[lhad]?|_)v?(vss|gnd|vgnd|vee)|^0$/i;   // VSS GND VGND DVSS VVSS VIRT_GND

  // Join '+' continuations, strip comments, normalize 'k = v' -> 'k=v'.
  function logicalLines(text) {
    const out = [];
    for (let raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line[0] === '*') continue;
      if (line[0] === '+') { if (out.length) out[out.length - 1] += ' ' + line.slice(1); continue; }
      out.push(line);
    }
    return out.map(l => {
      // $PINS is CDL named-pin syntax, any other '$' starts a comment. '//' also comments.
      const m = /\$(?!PINS)|\/\//i.exec(l);
      if (m) l = l.slice(0, m.index);
      return l.replace(/\s*=\s*/g, '=').replace(/[()]/g, ' ').trim();
    }).filter(Boolean);
  }

  function parse(text) {
    const subckts = {};     // lower-name -> def
    const models = {};      // lower model name -> 'pmos'|'nmos'|other
    const globals = [];
    const warnings = [];
    let cur = null;
    const top = { name: '(top)', ports: [], instances: [] };

    for (const line of logicalLines(text)) {
      const tok = line.split(/\s+/);
      const head = tok[0].toLowerCase();
      if (head[0] === '.') {
        if (head === '.subckt') {
          if (!tok[1]) { warnings.push('.subckt without a name ignored'); continue; }
          const params = {};
          const pins = [];
          let inPins = true;
          for (const t of tok.slice(2)) {
            if (t === '/') { inPins = false; continue; }
            if (t.includes('=')) { const [k, v] = t.split('='); params[k] = v; inPins = false; continue; }
            if (inPins) pins.push(t);
          }
          cur = { name: tok[1], ports: pins, params, instances: [] };
          subckts[tok[1].toLowerCase()] = cur;
        } else if (head === '.ends') {
          cur = null;
        } else if (head === '.global') {
          globals.push(...tok.slice(1));
        } else if (head === '.model') {
          models[tok[1].toLowerCase()] = (tok[2] || '').toLowerCase();
        } else if (head === '.include' || head === '.inc' || head === '.lib') {
          warnings.push(`${tok[0]} ${tok.slice(1).join(' ')} not resolved (drop the file too if it defines cells)`);
        }
        continue; // .param .option .end .temp ... ignored
      }
      const inst = parseElement(tok);
      if (inst) (cur || top).instances.push(inst);
    }
    if (top.instances.length) subckts['(top)'] = top;

    for (const s of Object.values(subckts)) for (const i of s.instances) {
      if (i.kind === 'X' && !subckts[i.model.toLowerCase()]) {
        const t = mosType(i.model, models);
        if (t) { i.kind = 'M'; i.type = t; }
        else warnings.push(`${s.name}: ${i.name} references undefined subckt ${i.model}`);
      } else if (i.kind === 'M') {
        i.type = mosType(i.model, models);
        if (!i.type) { i.type = 'nmos'; warnings.push(`${s.name}: ${i.name} model ${i.model} not recognized as pmos/nmos, drawn as nmos`); }
      }
      if (i.kind === 'X' && i.named && !i.pins.length) {
        const def = subckts[i.model.toLowerCase()];
        const byLower = Object.fromEntries(Object.entries(i.named).map(([k, v]) => [k.toLowerCase(), v]));
        if (def) i.pins = def.ports.map(p => byLower[p.toLowerCase()] ?? '?');
      }
    }
    return { subckts, models, globals, warnings, tops: findTops(subckts) };
  }

  // Xname pins... [/] subckt [params] [$PINS a=n ...]
  // Mname d g s [b] model [params]
  // other: pins... [value|model] [params]
  function parseElement(tok) {
    const name = tok[0];
    const kind = name[0].toUpperCase();
    if (!/[A-Z]/.test(kind)) return null;
    const pre = [], params = {};
    let named = null;
    for (const t of tok.slice(1)) {
      if (t.toUpperCase() === '$PINS') { named = {}; continue; }
      if (t.includes('=')) { const [k, v] = t.split('='); (named || params)[k] = v; }
      else if (!named) pre.push(t);
    }
    let pins = pre, model = '';
    const slash = pre.indexOf('/');
    if (slash >= 0) { pins = pre.slice(0, slash); model = pre[slash + 1] || ''; }
    else if ('RCLVIEGHFB'.includes(kind)) { pins = pre.slice(0, 2); model = pre[2] || ''; }   // two-terminal: value/model after the pins
    else model = pins.pop() || '';                                                     // M X Q D J: model is the last bare token
    return { name, kind, pins, model, params, named };
  }

  function mosType(model, models) {
    const m = models[model.toLowerCase()];
    if (m === 'pmos' || m === 'nmos') return m;
    if (PMOS_RE.test(model)) return 'pmos';
    if (NMOS_RE.test(model)) return 'nmos';
    return null;
  }

  function findTops(subckts) {
    const used = new Set();
    for (const s of Object.values(subckts)) for (const i of s.instances) if (i.kind === 'X') used.add(i.model.toLowerCase());
    return Object.values(subckts).filter(s => !used.has(s.name.toLowerCase())).map(s => s.name);
  }

  const override = { vcc: null, gnd: null };
  // Name-based supply match (user regexes first). Per-cell truth lives in def.rails, see computeRails.
  const rail = net => override.vcc?.test(net) ? 'vcc' : override.gnd?.test(net) ? 'gnd' : VDD_RE.test(net) ? 'vcc' : VSS_RE.test(net) ? 'gnd' : null;
  function setRailPatterns(vcc, gnd) {
    override.vcc = vcc ? new RegExp(vcc, 'i') : null;
    override.gnd = gnd ? new RegExp(gnd, 'i') : null;
  }

  // Per-cell supply nets: def.rails = Map net -> 'vcc'|'gnd'. Candidates are name matches, .global
  // nets that are never a gate, and nets wired to a child's power ports (propagated up the hierarchy).
  // A candidate reachable from a stronger same-polarity candidate through same-type channels (a power
  // switch) is demoted to a wire in that cell, so header/footer cells show the switch while the
  // cells they feed show a stub. Strength: .global > cell port > internal, then shorter name.
  function computeRails(netlist) {
    const done = new Map();
    const globals = new Set(netlist.globals);
    const forCell = def => {
      if (done.has(def)) return done.get(def);
      const rails = new Map();
      done.set(def, rails);                             // also breaks recursive hierarchies
      const gates = new Set(), touch = {}, adj = { pmos: {}, nmos: {} }, nets = new Set(def.ports);
      for (const i of def.instances) {
        i.pins.forEach(n => nets.add(n));
        if (i.kind !== 'M') continue;
        const [d, g, s] = i.pins;
        gates.add(g);
        for (const n of [d, s]) (touch[n] ??= { pmos: 0, nmos: 0 })[i.type]++;
        (adj[i.type][d] ??= []).push(s);
        (adj[i.type][s] ??= []).push(d);
      }
      const majority = n => { const t = touch[n]; return !t ? null : t.pmos > t.nmos ? 'vcc' : t.nmos ? 'gnd' : null; };
      const cand = new Map();
      for (const n of nets) { const p = rail(n); if (p) cand.set(n, p); }
      for (const n of nets) if (globals.has(n) && !cand.has(n) && !gates.has(n)) { const p = majority(n); if (p) cand.set(n, p); }
      for (const i of def.instances) if (i.kind === 'X') {
        const child = netlist.subckts[i.model.toLowerCase()];
        if (!child) continue;
        const cr = forCell(child);
        child.ports.forEach((p, k) => { const n = i.pins[k]; if (cr.has(p) && n && !cand.has(n) && !gates.has(n)) cand.set(n, cr.get(p)); });
      }
      const rank = n => (globals.has(n) ? 0 : def.ports.includes(n) ? 1 : 2) * 1000 + n.length;
      const demoted = new Set();
      for (const [c, p] of cand) {
        const t = p === 'vcc' ? 'pmos' : 'nmos';
        const stack = [c], seen = new Set(stack);
        while (stack.length) for (const n of adj[t][stack.pop()] || []) {
          if (seen.has(n)) continue;
          seen.add(n);
          if (cand.get(n) === p && rank(n) < rank(c)) demoted.add(c);
          stack.push(n);
        }
      }
      for (const [c, p] of cand) if (!demoted.has(c)) rails.set(c, p);
      return rails;
    };
    for (const def of Object.values(netlist.subckts)) def.rails = forCell(def);
    return netlist;
  }

  return { parse: text => computeRails(parse(text)), rail, mosType, setRailPatterns, computeRails };
})();
if (typeof module !== 'undefined') module.exports = SPICE;
