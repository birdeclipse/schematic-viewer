// UI glue: file loading, hierarchy tree, breadcrumb navigation, net highlight, pan/zoom.
(() => {
  const $ = id => document.getElementById(id);
  const view = $('view'), canvas = $('canvas');
  let netlist = null, cur = null, crumbs = [];
  let cellOf = {};   // instance name -> instance (current cell)
  const MAX_INSTANCES = 400;

  // ---------- loading ----------
  function load(text) {
    netlist = SPICE.parse(text);
    $('warnings').textContent = netlist.warnings.join('\n');
    $('drop').style.display = 'none';
    buildTree();
    crumbs = [];
    if (netlist.tops.length) show(netlist.tops[0]);
    else $('warnings').textContent += '\nNo cells found.';
  }
  async function loadFiles(files) {
    const texts = await Promise.all([...files].map(f => f.text()));
    load(texts.join('\n'));
  }
  $('file').onchange = e => loadFiles(e.target.files);
  canvas.ondragover = e => e.preventDefault();
  canvas.ondrop = e => { e.preventDefault(); loadFiles(e.dataTransfer.files); };
  // Host embedding (VS Code webview): the extension posts the document text.
  window.addEventListener('message', e => { if (e.data && e.data.type === 'load') load(e.data.text); });
  if (window.acquireVsCodeApi) { document.body.classList.add('embedded'); acquireVsCodeApi().postMessage({ type: 'ready' }); }
  for (const k of Object.keys(EXAMPLES)) $('example').add(new Option(k, k));
  $('example').onchange = e => { if (e.target.value) load(EXAMPLES[e.target.value]); };
  $('showval').onchange = e => view.classList.toggle('noval', !e.target.checked);
  // "VDD* VPWR, virt_pwr2" -> /^(VDD.*|VPWR|virt_pwr2)$/i ; names win over the built-in patterns.
  const globs = s => {
    const names = s.split(/[\s,;]+/).filter(Boolean);
    return names.length ? '^(' + names.map(n => n.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')).join('|') + ')$' : '';
  };
  for (const id of ['pwrnets', 'gndnets']) {
    $(id).value = localStorage.getItem(id) || '';
    $(id).onchange = () => {
      localStorage.setItem(id, $(id).value);
      SPICE.setRailPatterns(globs($('pwrnets').value), globs($('gndnets').value));
      if (netlist) { SPICE.computeRails(netlist); if (cur) show(cur.name, true); }
    };
  }
  SPICE.setRailPatterns(globs($('pwrnets').value), globs($('gndnets').value));

  // ---------- hierarchy tree ----------
  // Children grouped by sub-circuit (an array of 8192 bitcells is one row), expanded on demand.
  function buildTree() {
    const sub = n => netlist.subckts[n.toLowerCase()];
    // Row: [instance name] [cell name, truncated] [device count]; full text in the tooltip.
    const row = (inst, cellName, count) => {
      const a = document.createElement('a');
      a.className = 'row';
      a.href = '#';
      a.dataset.cell = cellName;
      a.title = inst ? `${inst} : ${cellName}` : cellName;
      a.onclick = e => { e.preventDefault(); crumbs = []; show(cellName); };
      if (inst) a.appendChild(Object.assign(document.createElement('span'), { className: 'inst', textContent: inst }));
      a.appendChild(Object.assign(document.createElement('span'), { className: 'cell', textContent: cellName }));
      const def = sub(cellName);
      if (def) a.appendChild(Object.assign(document.createElement('span'), { className: 'cnt', textContent: count > 1 ? `×${count} · ${def.instances.length}` : String(def.instances.length), title: `${count > 1 ? count + ' instances, ' : ''}${def.instances.length} devices in ${cellName}` }));
      return a;
    };
    const item = (inst, cellName, count = 1) => {
      const li = document.createElement('li');
      const a = row(inst, cellName, count);
      const def = sub(cellName);
      const groups = new Map();   // child model -> [instance names]
      if (def) for (const i of def.instances) if (i.kind === 'X' && sub(i.model)) (groups.get(i.model) ?? groups.set(i.model, []).get(i.model)).push(i.name);
      if (!groups.size) { li.appendChild(a); return li; }
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.appendChild(a);
      details.appendChild(summary);
      details.addEventListener('toggle', () => {
        if (!details.open || details.children.length > 1) return;
        const ul = document.createElement('ul');
        for (const [model, names] of groups) ul.appendChild(item(names.length > 1 ? `${names[0]}…` : names[0], model, names.length));
        details.appendChild(ul);
      });
      li.appendChild(details);
      return li;
    };
    const ul = document.createElement('ul');
    for (const t of netlist.tops) ul.appendChild(item('', t));
    $('tree').replaceChildren(ul);
    ul.querySelector('details')?.toggleAttribute('open', true);
  }

  // ---------- render one cell ----------
  async function show(name, fromCrumb = false) {
    const def = netlist.subckts[name.toLowerCase()];
    if (!def) return;
    cur = def;
    cellOf = Object.fromEntries(def.instances.map(i => [i.name, i]));
    if (!fromCrumb) crumbs.push(def.name);
    renderCrumbs();
    for (const a of $('tree').querySelectorAll('a')) a.classList.toggle('cur', a.dataset.cell.toLowerCase() === name.toLowerCase());
    $('tree').querySelector('a.cur')?.scrollIntoView({ block: 'nearest' });   // descending via double-click can land off-screen
    $('detail').textContent = `${def.name} (${def.ports.join(' ')})`;
    const pwr = [...def.rails].filter(([, p]) => p === 'vcc').map(([n]) => n), gnd = [...def.rails].filter(([, p]) => p === 'gnd').map(([n]) => n);
    $('rails').textContent = def.rails.size ? `⏚ ${pwr.join(' ')} / ${gnd.join(' ')}` : '⏚ none';
    // ponytail: ELK is O(n^2)-ish; above this a schematic is unreadable anyway. Show the instance list instead.
    if (def.instances.length > MAX_INSTANCES) {
      const pre = document.createElement('pre');
      pre.textContent = `${def.name}: ${def.instances.length} instances — too large to draw. Instances:\n` +
        def.instances.map(i => `  ${i.name} ${i.model} (${i.pins.join(' ')})`).join('\n');
      view.replaceChildren(pre);
      tf.x = 20; tf.y = 20; tf.k = 1; apply();
      return;
    }
    const conv = toYosys(def, netlist);
    if (!Object.keys(conv.json.modules[def.name].cells).length) {
      view.replaceChildren(Object.assign(document.createElement('pre'), { textContent: `${def.name}: nothing to draw (no devices, or only power pins)` }));
      tf.x = 20; tf.y = 20; tf.k = 1; apply();
      return;
    }
    let skin = SKIN;
    if (conv.symbols.length) skin = skin.replace('</svg>', conv.symbols.join('') + '</svg>');
    scene = { conv, skin, graph: null };
    await draw();
  }

  // Lay out and draw the current cell. `moved` = {id, dx, dy}: re-run ELK around a dragged node.
  let scene = null;   // { conv, skin, graph } of the drawn cell; graph = last ELK result
  async function draw(moved) {
    const { conv, skin } = scene;
    $('warnings').textContent = `Laying out ${cur.name} (${cur.instances.length} instances)…`;
    let out;
    try { out = await LAYOUT.render(skin, conv, moved && { ...moved, graph: scene.graph }); }
    catch (e) { $('warnings').textContent = `Render failed for ${cur.name}: ${e.message}`; return; }
    scene.graph = out.graph;
    $('warnings').textContent = netlist.warnings.join('\n');
    view.innerHTML = out.svg;
    decorate(view.querySelector('svg'), conv);
    if (pinned) setHL(`[data-net="${CSS.escape(pinned)}"]`, true);
    if (!moved) fit();
  }

  // Drag a laid-out node (its rail stubs come along). The groups follow the pointer and every wire on their
  // ports is re-routed as an orthogonal L/Z to its far anchor (a junction or another node's port), so a device
  // pulled closer gets a shorter wire and stays exactly where dropped. Shift-drop instead asks ELK to re-lay
  // out the cell with the node in its new row and order.
  function grab(g, e) {
    const id = g.id.slice(5);
    const graph = scene?.graph;
    if (!graph) return null;
    const byId = Object.fromEntries(graph.children.map(n => [n.id, n]));
    if (!byId[id]) return null;
    const cells = scene.conv.json.modules[cur.name].cells;
    const moving = LAYOUT.withStubs(graph, cells, id).map(k => byId[k]);
    const groups = moving.map(n => [n, view.querySelector(`#cell_${CSS.escape(n.id)}`)]);
    const key = (x, y) => `${Math.round(x)},${Math.round(y)}`;
    const svg = view.querySelector('svg');
    const at = {};                                          // wire endpoint -> lines touching it
    for (const l of svg.querySelectorAll(':scope > line')) for (const [a, b] of [['x1', 'y1'], ['x2', 'y2']]) (at[key(+l.getAttribute(a), +l.getAttribute(b))] ??= []).push(l);
    const stop = new Set([...svg.querySelectorAll(':scope > circle')].map(c => key(+c.getAttribute('cx'), +c.getAttribute('cy'))));   // junctions
    const port = (n, p) => ({ x: n.x + p.x, y: n.y + p.y, vertical: p.y <= 0 || p.y >= n.height });
    const own = new Set();
    for (const n of moving) for (const p of n.ports || []) own.add(key(n.x + p.x, n.y + p.y));
    for (const n of graph.children) if (!moving.includes(n)) for (const p of n.ports || []) stop.add(key(n.x + p.x, n.y + p.y));
    const far = (l, x, y) => (Math.abs(+l.getAttribute('x1') - x) < 0.5 && Math.abs(+l.getAttribute('y1') - y) < 0.5) ? [+l.getAttribute('x2'), +l.getAttribute('y2')] : [+l.getAttribute('x1'), +l.getAttribute('y1')];
    // Walk each wire from a moving port until a junction, a foreign port, or a fork.
    const wires = [], seen = new Set();
    for (const n of moving) for (const p of n.ports || []) {
      const s = port(n, p);
      for (const first of at[key(s.x, s.y)] || []) {
        if (seen.has(first)) continue;
        const lines = [first];
        let [x, y] = far(first, s.x, s.y), last = first;
        while (!stop.has(key(x, y)) && !own.has(key(x, y))) {
          const next = (at[key(x, y)] || []).filter(l => l !== last);
          if (next.length !== 1) break;
          last = next[0]; lines.push(last); [x, y] = far(last, x, y);
        }
        lines.forEach(l => seen.add(l));
        const vertical = Math.abs(+last.getAttribute('x1') - +last.getAttribute('x2')) < 0.5;
        const pts = lines.map(l => ['x1', 'y1', 'x2', 'y2'].map(a => +l.getAttribute(a)));   // original geometry, for translating
        wires.push({ s, a: { x, y, vertical }, both: own.has(key(x, y)), cls: first.getAttribute('class'), net: first.dataset.net, lines, pts, drawn: [] });
      }
    }
    const route = ({ s, a, dx, dy }) => {                // start at the moved port, end at the anchor
      const S = { x: s.x + dx, y: s.y + dy }, A = a;
      const pts = s.vertical && a.vertical ? [S, { x: S.x, y: (S.y + A.y) / 2 }, { x: A.x, y: (S.y + A.y) / 2 }, A]
        : !s.vertical && !a.vertical ? [S, { x: (S.x + A.x) / 2, y: S.y }, { x: (S.x + A.x) / 2, y: A.y }, A]
        : s.vertical ? [S, { x: S.x, y: A.y }, A] : [S, { x: A.x, y: S.y }, A];
      return pts.filter((p, i) => !i || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
    };
    let dx = 0, dy = 0;
    const touched = new Set(wires.filter(w => !w.both && scene.conv.wired.includes(w.net)).map(w => w.net));
    const move = (mx, my) => {
      dx = mx; dy = my;
      for (const [n, el] of groups) el?.setAttribute('transform', `translate(${n.x + dx},${n.y + dy})`);
      for (const w of wires) {
        if (w.both) {                                    // stub wire: both ends move, keep its shape
          w.lines.forEach((l, i) => { const [x1, y1, x2, y2] = w.pts[i]; l.setAttribute('x1', x1 + dx); l.setAttribute('y1', y1 + dy); l.setAttribute('x2', x2 + dx); l.setAttribute('y2', y2 + dy); });
          continue;
        }
        w.lines.forEach(l => l.remove());
        w.drawn.forEach(l => l.remove());
        const pts = route({ ...w, dx, dy });
        w.drawn = pts.slice(1).map((p, i) => {
          const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          l.setAttribute('x1', pts[i].x); l.setAttribute('y1', pts[i].y); l.setAttribute('x2', p.x); l.setAttribute('y2', p.y);
          l.setAttribute('class', w.cls); l.dataset.net = w.net;
          return svg.appendChild(l);
        });
      }
      for (const net of touched) placeName(svg, net);
    };
    return {
      x0: e.clientX, y0: e.clientY, move,
      drop(shift) {
        if (Math.hypot(dx, dy) <= 4) return;
        if (shift) { draw({ id, dx, dy }); return; }
        for (const n of moving) { n.x += dx; n.y += dy; }   // keep the graph honest for the next drag
      },
    };
  }

  function renderCrumbs() {
    const el = $('crumbs');
    el.replaceChildren();
    crumbs.forEach((c, i) => {
      if (i) el.appendChild(Object.assign(document.createElement('span'), { textContent: '›' }));
      const a = document.createElement('a');
      a.textContent = c;
      a.onclick = () => { crumbs = crumbs.slice(0, i + 1); show(c, true); };
      el.appendChild(a);
    });
  }

  // Net-name text on the longest wire segment of a net (ports have flags already).
  function placeName(svg, net) {
    let s = null;
    for (const l of svg.querySelectorAll(`:scope > line[data-net="${CSS.escape(net)}"]`)) {
      const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map(a => +l.getAttribute(a));
      const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
      if (!s || len > s.len) s = { len, x1, y1, x2, y2 };
    }
    svg.querySelector(`text.netname[data-net="${CSS.escape(net)}"]`)?.remove();
    if (!s || cur.ports.includes(net)) return;
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const horiz = s.y1 === s.y2;
    t.setAttribute('x', (s.x1 + s.x2) / 2 + (horiz ? 0 : 4));
    t.setAttribute('y', (s.y1 + s.y2) / 2 + (horiz ? -3 : 3));
    if (horiz) t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'netname');
    t.dataset.net = net;
    t.textContent = net;
    svg.appendChild(t);
  }

  // Tag wires/labels/stubs with data-net, tag device groups with data-inst, add net-name text on shared wires.
  function decorate(svg, { bitNet, labelNet, wired }) {
    for (const el of svg.querySelectorAll('[class*="net_"]')) {
      const m = /(?:^|\s)net_(\d+)/.exec(el.getAttribute('class'));
      if (m) el.dataset.net = bitNet[m[1]];
    }
    for (const net of wired) placeName(svg, net);
    for (const g of svg.querySelectorAll('g[id^="cell_"]')) {
      const key = g.id.slice(5);
      if (key in labelNet) { for (const c of g.querySelectorAll('*')) c.dataset.net = labelNet[key]; continue; }
      const inst = cellOf[key];
      if (!inst) continue;
      g.dataset.inst = key;
      if (inst.kind === 'M') g.querySelector('text.gate').dataset.net = inst.pins[1];
      if (inst.kind === 'X' && netlist.subckts[inst.model.toLowerCase()]) g.classList.add('hier');
    }
  }

  // ---------- interaction ----------
  const setHL = (sel, on) => { for (const el of view.querySelectorAll(sel)) el.classList.toggle('hl', on); };
  let pinned = null;
  view.addEventListener('mouseover', e => {
    const n = e.target.closest('[data-net]');
    if (n) setHL(`[data-net="${CSS.escape(n.dataset.net)}"]`, true);
  });
  view.addEventListener('mouseout', e => {
    const n = e.target.closest('[data-net]');
    if (n && n.dataset.net !== pinned) setHL(`[data-net="${CSS.escape(n.dataset.net)}"]`, false);
  });
  view.addEventListener('click', e => {
    const n = e.target.closest('[data-net]');
    if (n) { if (pinned) setHL(`[data-net="${CSS.escape(pinned)}"]`, false); pinned = n.dataset.net; setHL(`[data-net="${CSS.escape(pinned)}"]`, true); }
    const g = e.target.closest('[data-inst]');
    if (!g) return;
    const i = cellOf[g.dataset.inst];
    const pins = i.kind === 'M' ? ['D', 'G', 'S', 'B'] : (netlist.subckts[i.model.toLowerCase()]?.ports || []);
    const conn = i.pins.map((p, k) => `${pins[k] || k}=${p}`).join(' ');
    const params = Object.entries(i.params).map(([k, v]) => `${k}=${v}`).join(' ');
    $('detail').textContent = `${i.name}: ${i.type || i.model} ${conn} ${params}`;
  });
  view.addEventListener('dblclick', e => {
    const g = e.target.closest('.hier');
    if (g) show(cellOf[g.dataset.inst].model);
  });
  $('search').onkeydown = e => {
    if (e.key !== 'Enter' || !cur) return;
    const q = e.target.value.trim().toLowerCase();
    if (pinned) setHL(`[data-net="${CSS.escape(pinned)}"]`, false);
    setHL('.hl', false);
    pinned = null;
    if (!q) return;
    for (const el of view.querySelectorAll('[data-net]')) if (el.dataset.net.toLowerCase() === q) { el.classList.add('hl'); pinned = el.dataset.net; }
    for (const g of view.querySelectorAll('[data-inst]')) if (g.dataset.inst.toLowerCase() === q) for (const c of g.querySelectorAll('*')) c.classList.add('hl');
  };

  // ---------- pan / zoom ----------
  const tf = { x: 20, y: 20, k: 1 };
  const GRID = 10;   // schematic units; major line every 10 cells
  const apply = () => {
    view.style.transform = `translate(${tf.x}px,${tf.y}px) scale(${tf.k})`;
    const s = GRID * tf.k, m = s * 10;   // grid drawn in screen space, anchored to the schematic origin
    canvas.style.backgroundSize = `${m}px ${m}px, ${m}px ${m}px, ${s}px ${s}px, ${s}px ${s}px`;
    canvas.style.backgroundPosition = `${tf.x}px ${tf.y}px`;
    $('zoom').textContent = `${Math.round(tf.k * 100)}%`;
  };
  // Zoom by factor f about canvas point (mx, my)
  const zoomAt = (f, mx = canvas.clientWidth / 2, my = canvas.clientHeight / 2) => {
    tf.x = mx - (mx - tf.x) * f;
    tf.y = my - (my - tf.y) * f;
    tf.k *= f;
    apply();
  };
  function fit() {
    const svg = view.querySelector('svg');
    if (!svg) return;
    const w = +svg.getAttribute('width') || 1, h = +svg.getAttribute('height') || 1;
    tf.k = Math.min((canvas.clientWidth - 40) / w, (canvas.clientHeight - 40) / h, 2);
    tf.x = (canvas.clientWidth - w * tf.k) / 2;
    tf.y = (canvas.clientHeight - h * tf.k) / 2;
    apply();
  }
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $('zoomin').onclick = () => zoomAt(1.25);
  $('zoomout').onclick = () => zoomAt(0.8);
  $('zoom').onclick = () => zoomAt(1 / tf.k);
  $('fit').onclick = fit;
  $('showgrid').onchange = e => canvas.classList.toggle('grid', e.target.checked);
  canvas.classList.toggle('grid', $('showgrid').checked);
  apply();
  // Left-drag on a node moves it (see grab); anywhere else pans.
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('#tools')) return;
    const node = e.target.closest('g[id^="cell_"]');
    drag = (node && grab(node, e)) || { x: e.clientX - tf.x, y: e.clientY - tf.y };
    canvas.classList.add('drag');
  });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.move) drag.move((e.clientX - drag.x0) / tf.k, (e.clientY - drag.y0) / tf.k);
    else { tf.x = e.clientX - drag.x; tf.y = e.clientY - drag.y; apply(); }
  });
  window.addEventListener('pointerup', e => { drag?.drop?.(e.shiftKey); drag = null; canvas.classList.remove('drag'); });
  window.addEventListener('resize', fit);
  window.addEventListener('keydown', e => { if (e.key === 'f' && e.target === document.body) fit(); });
})();
