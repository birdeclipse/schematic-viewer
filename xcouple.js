// Cross-coupled cores (SRAM cell, sense amp, latch, clocked-inverter latch, level-shifter PMOS
// pair) drawn textbook style: two stacks facing each other, feedback wires between them, pass
// transistors horizontal on the outer sides, shared tail devices and rail chain ends exposed as
// pins (the rail stubs come from ELK, on the cell's shared VDD/VSS rows).
// find() picks the devices, symbol() emits a netlistsvg skin glyph.
const XC = (() => {
  const railOf = t => (t === 'pmos' ? 'vcc' : 'gnd');
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const tw = s => 6 * String(s).length;
  const MAX_SERIES = 4;

  // mos: [{i:name, d, g, s, type, model, value}] with D/S already oriented (source faces the rail).
  function find(mos, rail) {
    const byDrain = {}, fanout = {};
    for (const m of mos) { (byDrain[m.d] ??= []).push(m); fanout[m.d] = (fanout[m.d] || 0) + 1; fanout[m.s] = (fanout[m.s] || 0) + 1; }
    const used = new Set(), clusters = [];
    const nets = Object.keys(byDrain);
    for (const A of nets) for (const B of nets) {
      if (A >= B) continue;
      const c = build(A, B, mos, used, fanout, rail);
      if (c) { clusters.push(c); for (const m of c.devices) used.add(m.i); }
    }
    return clusters;
  }

  // Series chain from a node toward the rail through same-type devices: [node-adjacent, ..., rail-adjacent].
  // A chain may also end at a dangling net (extraction artefact, no other device): drawn as an open stub.
  function chain(m, A, B, mos, used, fanout, rail) {
    const out = [m];
    for (let cur = m; rail(cur.s) !== railOf(m.type);) {
      if (cur.s === A || cur.s === B || out.length >= MAX_SERIES) return null;
      if (fanout[cur.s] === 1) { out.open = true; return out; }
      const next = mos.filter(x => !used.has(x.i) && x.type === m.type && x.d === cur.s);
      if (next.length !== 1) return null;
      cur = next[0];
      out.push(cur);
    }
    return out;
  }

  // Identical parallel chains (multi-finger devices) collapse into one column with joined names.
  function mergeFingers(chains) {
    const groups = new Map();
    for (const ch of chains) {
      const key = ch.map(m => `${m.type}|${m.g}|${m.s}`).join('>') + (ch.tail ? '$' : '') + (ch.open ? '?' : '');
      const g = groups.get(key);
      if (g) g.forEach((m, j) => { m.label += ',' + ch[j].i; });
      else { const c = ch.map(m => ({ ...m, label: m.i })); c.tail = ch.tail; groups.set(key, c); }
    }
    return [...groups.values()];
  }

  function build(A, B, mos, used, fanout, rail) {
    const cols = { [A]: [], [B]: [] };
    for (const node of [A, B]) for (const m of mos) {
      if (used.has(m.i) || m.d !== node || m.s === A || m.s === B) continue;
      const ch = chain(m, A, B, mos, used, fanout, rail);
      if (ch) cols[node].push(ch);
    }
    // A device reached from both sides is a shared tail (sense-amp foot): cut both chains there.
    const inA = new Set(cols[A].flat().map(m => m.i));
    const shared = new Set(cols[B].flat().filter(m => inA.has(m.i)).map(m => m.i));
    const tail = {};
    for (const node of [A, B]) for (const ch of cols[node]) {
      const k = ch.findIndex(m => shared.has(m.i));
      if (k >= 0) { tail[ch[k].type] = ch[k].d; ch.length = k; ch.tail = true; }
    }
    for (const node of [A, B]) cols[node] = cols[node].filter(ch => ch.length);
    const stacks = { [A]: cols[A].flat(), [B]: cols[B].flat() };
    if (!stacks[A].some(m => m.g === B) || !stacks[B].some(m => m.g === A)) return null;
    const inStack = new Set([...stacks[A], ...stacks[B]].map(m => m.i));
    const pass = { [A]: [], [B]: [] };
    for (const m of mos) {
      if (used.has(m.i) || inStack.has(m.i) || shared.has(m.i)) continue;
      const onA = m.d === A || m.s === A, onB = m.d === B || m.s === B;
      if (onA === onB) continue;                      // neither, or bridging A-B (equalizer): leave to ELK
      const node = onA ? A : B, other = m.d === node ? m.s : m.d;
      if (other !== node) pass[node].push({ ...m, node, other });
    }
    const devices = [...stacks[A], ...stacks[B], ...pass[A], ...pass[B]];
    for (const node of [A, B]) {
      cols[node] = mergeFingers(cols[node]);
      const groups = new Map();                     // parallel pass fingers: same gate and same far net
      for (const m of pass[node]) {
        const key = `${m.type}|${m.g}|${m.other}`;
        const g = groups.get(key);
        if (g) g.label += ',' + m.i; else groups.set(key, { ...m, label: m.i });
      }
      pass[node] = [...groups.values()];
    }
    return { A, B, cols, pass, tail, devices };
  }

  // Base MOS glyph 30x40: gate stub left at y=20, top terminal (24,0), bottom terminal (24,40).
  const GLYPH = {
    nmos: 'M0,20 H10 M10,11 V29 M14,10 V30 M14,14 H24 V0 M14,26 H24 V40|M14,26 L20,23 V29 Z|',
    pmos: 'M0,20 H5 M11,11 V29 M14,10 V30 M14,14 H24 V0 M14,26 H24 V40|M20,14 L14,11 V17 Z|<circle cx="8" cy="20" r="3" class="symbol"/>',
  };
  const glyph = (m, tf) => {
    const [p, arrow, extra] = GLYPH[m.type].split('|');
    return `<g data-inst="${esc(m.i)}" transform="${tf}"><path d="${p}" class="symbol"/><path d="${arrow}" class="detail"/>${extra}</g>`;
  };
  const text = (x, y, s, cls, anchor = 'start', net) =>
    `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}"${net ? ` data-net="${esc(net)}"` : ''}>${esc(s)}</text>`;
  const wire = (d, net) => `<path d="${d}" class="symbol" data-net="${esc(net)}"/>`;
  const dot = (x, y, net) => `<circle cx="${x}" cy="${y}" r="2" class="detail" data-net="${esc(net)}"/>`;
  const hopR = (x, y) => `H${x - 4} A4,4 0 0 1 ${x + 4},${y}`;   // going right, arc over x
  const hopL = (x, y) => `H${x + 4} A4,4 0 0 0 ${x - 4},${y}`;   // going left, arc over x
  const labelBlock = (x, y, m, a) => text(x, y, m.label ?? m.i, 'ref', a) + text(x, y + 10, m.model, 'val', a) + text(x, y + 20, m.value, 'val', a);
  // Inline flag/name at an outer terminal for nets that have no other endpoint in the cell.
  const flag = (xe, y, net, dir, left) => {
    const s = left ? 1 : -1, tip = dir === 'out' ? left : !left;
    const shape = dir ? (tip
      ? `M${xe},${y - 8} V${y + 8} H${xe - 7 * s} L${xe - 15 * s},${y} L${xe - 7 * s},${y - 8} Z`
      : `M${xe - 15 * s},${y - 8} V${y + 8} H${xe - 8 * s} L${xe},${y} L${xe - 8 * s},${y - 8} Z`) : '';
    return (shape ? `<path d="${shape}" class="flag" data-net="${esc(net)}"/>` : '') + text(xe - (dir ? 18 : 4) * s, y + 4, net, 'ref', left ? 'end' : 'start', net);
  };
  const ROW_DY = 80, SER_DY = 50;

  // Returns { svg, pins:[{pid, net, x, y, position}], W, H }.
  // use[net]: count of wired endpoints in the cell (own pass pins included); portOf(net): 'in'|'out'|null.
  function symbol(c, id, use, portOf, rail) {
    const lonely = net => !rail(net) && (use[net] || 0) <= 1;
    const sides = [c.A, c.B].map((node, k) => {
      const other = k ? c.A : c.B, pass = c.pass[node];
      const cross = ch => ch.filter(m => m.g === other).length;
      const byType = t => c.cols[node].filter(ch => ch[0].type === t).sort((a, b) => cross(b) - cross(a));
      const P = byType('pmos'), N = byType('nmos');
      // column i (0 = innermost, next to the middle) pairs P[i] over N[i]
      const n = Math.max(P.length, N.length, 1);
      const columns = Array.from({ length: n }, (_, i) => {
        const devs = [...(P[i] || []), ...(N[i] || [])];
        return {
          P: P[i] || [], N: N[i] || [],
          labelW: Math.max(40, 12 + Math.max(0, ...devs.flatMap(m => [tw(m.label), tw(m.model), tw(m.value)]))),
          gateW: Math.max(0, ...devs.filter(m => m.g !== other).map(m => tw(m.g) + 16)),
        };
      });
      const passLen = Math.max(0, ...pass.flatMap(m => [tw(m.i), tw(m.model), tw(m.value)]));
      const ext = (use[node] || 0) > 0, port = portOf(node);
      const lonelyLen = Math.max(0, ...pass.filter(m => lonely(m.other)).map(m => tw(m.other) + 24), ext ? 0 : port ? tw(node) + 24 : 0);
      const stackW = columns.reduce((w, col, i) => w + col.labelW + 42 + (i ? col.gateW : 0), 0);
      return {
        node, other, columns, pass, use: ext, port,
        passW: pass.length || ext || port ? Math.max(70, passLen + 30, lonelyLen + 66) : 10,
        stackW,
      };
    });
    const [L, R] = sides;
    const DP = Math.max(1, ...sides.flatMap(S => S.columns.map(col => col.P.length)));
    const DN = Math.max(1, ...sides.flatMap(S => S.columns.map(col => col.N.length)));
    const NODE_Y = SER_DY * DP + 50;                              // top P glyph row sits at y=40
    for (const S of sides) S.yQ = NODE_Y + ROW_DY * S.pass.length;
    const MW = Math.max(60, 30 + L.columns[0].gateW + R.columns[0].gateW);
    const xbL = L.passW + L.stackW + 5;            // left gate bar
    const xbR = xbL + MW;                          // right gate bar
    const W = xbR + 5 + R.stackW + R.passW;
    const yN = NODE_Y + SER_DY * DN + 10;          // bottom of the lowest N glyph
    const H = Math.max(yN + 20, L.yQ + 12, R.yQ + 12, c.tail.nmos ? yN + 40 : 0);
    const out = [], pins = [];

    // ---- stacks: columns laid out from the gate bar outward ----
    for (const [k, S] of sides.entries()) {
      const xb = k ? xbR : xbL;
      const barYs = [k ? NODE_Y - 8 : NODE_Y + 8];
      S.termXs = [];
      let x = xb + (k ? 5 : -5);                   // current inner edge of the column being placed
      S.columns.forEach((col, i) => {
        if (i) x += k ? col.gateW : -col.gateW;    // gate-name slot between columns (innermost uses the middle)
        const gx = k ? x : x - 30;                 // glyph left edge
        const t = k ? gx + 24 : gx + 6;            // terminal x
        S.termXs.push(t);
        for (const [isP, ch] of [[true, col.P], [false, col.N]]) {
          ch.forEach((m, j) => {                   // j = 0 is node-adjacent
            const gy = isP ? NODE_Y - 60 - SER_DY * j : NODE_Y + 20 + SER_DY * j, gyy = gy + 20;
            const gEdge = k ? gx : gx + 30;
            out.push(glyph(m, k ? `translate(${gx},${gy})` : `translate(${gx + 30},${gy}) scale(-1,1)`));
            if (m.g === S.other) {                 // cross-coupled gate: join the bar
              out.push(wire(`M${gEdge},${gyy} H${xb}`, m.g), dot(xb, gyy, m.g));
              barYs.push(gyy);
            } else {                               // independent gate: short stub + name
              out.push(wire(`M${gEdge},${gyy} H${k ? gEdge - 8 : gEdge + 8}`, m.g));
              out.push(text(k ? gEdge - 10 : gEdge + 10, gyy + 3, m.g, 'ref', k ? 'end' : 'start', m.g));
            }
            out.push(labelBlock(k ? gx + 36 : gx - 6, gy + 12, m, k ? 'start' : 'end'));
            if (j) out.push(wire(isP ? `M${t},${gy + 40} V${gy + 50}` : `M${t},${gy - 10} V${gy}`, m.d));
          });
          if (!ch.length) continue;
          const gyEnd = isP ? NODE_Y - 60 - SER_DY * (ch.length - 1) : NODE_Y + 20 + SER_DY * (ch.length - 1);
          out.push(wire(isP ? `M${t},${NODE_Y - 20} V${NODE_Y}` : `M${t},${NODE_Y} V${NODE_Y + 20}`, S.node));
          if (S.columns.length > 1 || S.pass.length || S.use || S.port) out.push(dot(t, NODE_Y, S.node));
          const last = ch[ch.length - 1];
          if (ch.tail) out.push(wire(isP ? `M${t},${gyEnd} V28` : `M${t},${gyEnd + 40} V${yN + 12}`, last.s));
          else {                                   // rail (or open) end: a pin on the glyph edge, ELK adds the stub
            out.push(wire(isP ? `M${t},0 V${gyEnd}` : `M${t},${gyEnd + 40} V${H}`, last.s));
            pins.push({ pid: `${isP ? 'P' : 'N'}${k}${i}`, net: last.s, x: t, y: isP ? 0 : H, position: isP ? 'top' : 'bottom' });
          }
        }
        x = k ? gx + 36 + col.labelW + 6 : gx - 6 - col.labelW - 6;
      });
      S.outer = x;                                 // outer edge of the stack region
      out.push(text(S.outer, NODE_Y - 4, S.node, 'netname', k ? 'end' : 'start', S.node));
      out.push(wire(`M${xb},${Math.min(...barYs)} V${Math.max(...barYs)}`, S.other));
    }
    // node wires across the columns, then feedback to the opposite bar with a hop over the own bar
    const lIn = Math.max(...L.termXs), rIn = Math.min(...R.termXs);
    out.push(wire(`M${Math.min(...L.termXs)},${NODE_Y} H${lIn} V${NODE_Y - 8} ${hopR(xbL, NODE_Y - 8)} H${xbR}`, c.A), dot(xbR, NODE_Y - 8, c.A), dot(lIn, NODE_Y, c.A));
    out.push(wire(`M${Math.max(...R.termXs)},${NODE_Y} H${rIn} V${NODE_Y + 8} ${hopL(xbR, NODE_Y + 8)} H${xbL}`, c.B), dot(xbL, NODE_Y + 8, c.B), dot(rIn, NODE_Y, c.B));

    // ---- shared tails (e.g. sense-amp foot) become a top/bottom port ----
    for (const [t, y, pid, position] of [['pmos', 28, 'TP', 'top'], ['nmos', yN + 12, 'TN', 'bottom']]) {
      const net = c.tail[t];
      if (!net) continue;
      const xs = sides.flatMap(S => S.columns.map((col, i) => ((t === 'pmos' ? col.P : col.N).tail ? S.termXs[i] : null)).filter(x => x !== null));
      const xm = Math.round((xbL + xbR) / 2), yp = position === 'top' ? 0 : H;
      out.push(wire(`M${Math.min(...xs, xm)},${y} H${Math.max(...xs, xm)} M${xm},${y} V${yp}`, net));
      pins.push({ pid, net, x: xm, y: yp, position });
    }

    // ---- pass transistors (horizontal, outer sides) and node ports ----
    for (const [k, S] of sides.entries()) {
      if (!S.pass.length && !S.use && !S.port) continue;
      const xBus = k ? W - S.passW + 10 : S.passW - 10;
      const xPort = k ? W : 0;
      S.pass.forEach((m, j) => {
        const y = NODE_Y + ROW_DY * j;
        const x0 = k ? xBus + 10 : xBus - 50;        // glyph spans x0..x0+40, terminals on row y
        // base top terminal is D for nmos, S for pmos. matrix(0,1,1,0) puts it left; matrix(0,1,-1,0,40,0) right.
        const topIsNode = (m.d === m.node) === (m.type === 'nmos');
        const flip = topIsNode === !k;
        out.push(glyph(m, `translate(${x0},${y - 24}) ${flip ? 'matrix(0,1,-1,0,40,0)' : 'matrix(0,1,1,0,0,0)'}`));
        out.push(wire(`M${k ? x0 : x0 + 40},${y} H${xBus}`, S.node));
        if (lonely(m.other)) out.push(wire(`M${k ? x0 + 40 : x0},${y} H${k ? x0 + 48 : x0 - 8}`, m.other), flag(k ? x0 + 48 : x0 - 8, y, m.other, portOf(m.other), !k));
        else { out.push(wire(`M${xPort},${y} H${k ? x0 + 40 : x0}`, m.other)); pins.push({ pid: (k ? 'R' : 'L') + j, net: m.other, x: xPort, y, position: k ? 'right' : 'left' }); }
        out.push(text(x0 + 20, y - 28, m.g, 'ref', 'middle', m.g));
        out.push(labelBlock(k ? x0 : x0 + 40, y + 18, m, k ? 'start' : 'end'));
        if (j || S.use || S.port) out.push(dot(xBus, y, S.node));
      });
      const yEnd = S.use || S.port ? S.yQ : NODE_Y + ROW_DY * (S.pass.length - 1);
      if (yEnd > NODE_Y) out.push(wire(`M${xBus},${NODE_Y} V${yEnd}`, S.node));
      out.push(wire(`M${xBus},${NODE_Y} H${k ? Math.max(...R.termXs) : Math.min(...L.termXs)}`, S.node));
      if (S.use) {
        out.push(wire(`M${xPort},${S.yQ} H${xBus}`, S.node));
        pins.push({ pid: k ? 'QB' : 'Q', net: S.node, x: xPort, y: S.yQ, position: k ? 'right' : 'left' });
      } else if (S.port) {
        const xe = k ? xBus + 30 : xBus - 30;
        out.push(wire(`M${xBus},${S.yQ} H${xe}`, S.node), flag(xe, S.yQ, S.node, S.port, !k));
      }
    }

    const ports = pins.map(p => `<g s:x="${p.x}" s:y="${p.y}" s:pid="${p.pid}" s:position="${p.position}"/>`).join('');
    return { svg: `<g s:type="${id}" s:width="${W}" s:height="${H}"><s:alias val="${id}"/>${out.join('')}${ports}</g>`, pins, W, H };
  }

  return { find, symbol };
})();
if (typeof module !== 'undefined') module.exports = XC;
