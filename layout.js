// ELK layout of a converted cell. netlistsvg builds the graph from the Yosys JSON; we assign the rows
// (ELK layers) ourselves and let ELK order, place and route:
//   - one shared layering for the whole cell, so supplies line up across stages: VDD stubs on row 0,
//     PMOS counted down from VDD, NMOS counted up from VSS, VSS stubs on the last row. ELK's own
//     network-simplex layering can't be steered into this: it balances nodes with equal in/out degree
//     into the emptiest layer regardless of edge weights, so a lone NMOS floats up to the output row.
//   - PMOS hug the top of their row and NMOS the bottom (in-layer alignment);
//   - netlist order is the left-to-right tie-breaker (model order), so stages come out as written.
// render() with `moved` re-runs ELK interactively: the previous positions seed row and order, the moved
// node (plus its private rail stubs) is offset by the drag, and ELK re-routes cleanly around it.
const LAYOUT = (() => {
  const E = 'org.eclipse.elk.';
  const BASE = {
    [E + 'layered.spacing.nodeNodeBetweenLayers']: 24,
    [E + 'spacing.nodeNode']: 20,
    [E + 'separateConnectedComponents']: false,
    [E + 'layered.nodePlacement.strategy']: 'NETWORK_SIMPLEX',
    [E + 'layered.considerModelOrder.strategy']: 'NODES_AND_EDGES',
  };
  const ROWS = {                                       // rows come from node positions (see rows())
    [E + 'layered.cycleBreaking.strategy']: 'INTERACTIVE',
    [E + 'layered.layering.strategy']: 'INTERACTIVE',
  };
  const INTERACTIVE = {                                // ...and so do the order within a row and the x positions
    ...ROWS,
    [E + 'layered.considerModelOrder.strategy']: 'NONE',
    [E + 'layered.crossingMinimization.strategy']: 'INTERACTIVE',
    [E + 'layered.nodePlacement.strategy']: 'INTERACTIVE',
  };
  const ALIGN = { pmos: 'TOP', nmos: 'BOTTOM' };
  const RAIL = new Set(['vcc', 'gnd']);
  const LATE = new Set(['nmos', 'gnd', 'port_in']);   // placed as late as their consumers allow
  const ROW_PITCH = 1e4;                               // taller than any glyph, so rows never overlap
  const owner = ref => ref.split('.')[0];
  const ends = e => [owner(e.sources?.[0] ?? e.source), owner(e.targets?.[0] ?? e.target)];   // netlistsvg dummies use the legacy edge shape

  // Row of every node: longest path from the sources (VDD stubs, PMOS chains), then NMOS, VSS stubs and
  // input flags are pushed down to sit right above whatever they feed. Back edges of cycles are ignored.
  function rows(graph, cells) {
    const succ = {}, pred = {};
    for (const e of graph.edges) { const [s, t] = ends(e); (succ[s] ??= []).push(t); (pred[t] ??= []).push(s); }
    const state = {}, order = [];
    const visit = v => {
      state[v] = 1;
      for (const t of succ[v] || []) {
        if (state[t] === 1) { succ[v] = succ[v].filter(x => x !== t); pred[t] = pred[t].filter(x => x !== v); }   // back edge
        else if (!state[t]) visit(t);
      }
      state[v] = 2;
      order.push(v);
    };
    for (const n of graph.children) if (!state[n.id]) visit(n.id);
    order.reverse();
    const row = {};
    for (const v of order) row[v] = Math.max(-1, ...(pred[v] || []).map(p => row[p])) + 1;
    const last = Math.max(0, ...Object.values(row));
    for (const v of [...order].reverse()) if (LATE.has(cells[v]?.type)) row[v] = Math.min(last + 1, ...(succ[v] || []).map(s => row[s])) - 1;
    return row;
  }

  // A node plus the rail stubs hanging off its pins: they move as one.
  function withStubs(graph, cells, id) {
    const out = [id];
    for (const e of graph.edges) {
      const [s, t] = ends(e);
      if (s === id && RAIL.has(cells[t]?.type)) out.push(t);
      if (t === id && RAIL.has(cells[s]?.type)) out.push(s);
    }
    return out;
  }

  // moved: { graph: previous laid-out graph, id, dx, dy }. Returns { svg, graph, name }.
  async function render(skin, conv, moved) {
    const [name, mod] = Object.entries(conv.json.modules)[0];
    const cells = mod.cells;
    let graph;
    netlistsvg.dumpLayout(skin, conv.json, true, (err, text) => { if (err) throw err; graph = JSON.parse(text); });
    for (const n of graph.children) {
      const a = ALIGN[cells[n.id]?.type];
      if (a) (n.layoutOptions ??= {})[E + 'alignment'] = a;
    }
    const options = { ...BASE, [E + 'direction']: conv.hasMos ? 'DOWN' : 'RIGHT' };
    if (moved) {
      Object.assign(options, INTERACTIVE);
      const prev = Object.fromEntries(moved.graph.children.map(n => [n.id, n]));
      const shift = new Set(withStubs(graph, cells, moved.id));
      for (const n of graph.children) {
        const p = prev[n.id];
        if (!p) continue;
        n.x = p.x + (shift.has(n.id) ? moved.dx : 0);
        n.y = p.y + (shift.has(n.id) ? moved.dy : 0);
      }
    } else if (conv.hasMos) {
      Object.assign(options, ROWS);
      const row = rows(graph, cells);
      for (const n of graph.children) { n.x = 0; n.y = row[n.id] * ROW_PITCH; }
    }
    const laid = await new ELK().layout(graph, { layoutOptions: options });
    const svg = await netlistsvg.render(skin, conv.json, null, JSON.parse(JSON.stringify(laid)));   // drawModule mutates its input
    return { svg, graph: laid, name };
  }

  return { render, rows, withStubs };
})();
if (typeof module !== 'undefined') module.exports = LAYOUT;
