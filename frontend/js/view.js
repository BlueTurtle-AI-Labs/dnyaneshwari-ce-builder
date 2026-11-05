/*
 * The chain view: one column per edition, blocks as cards joined by a chain,
 * bezier links between columns, hover anchor points and drag-to-link.
 *
 * Coordinates: everything is in "canvas space" (origin = top-left of #canvas,
 * i.e. just under the sticky column headers). Card positions are computed from
 * their index, so cards can be virtualised and links never depend on the DOM.
 */
(function (D) {
  'use strict';
  const S = D.state, el = D.el, svg = D.svg, $ = D.$;

  const L = (D.layout = {
    COL_W: 300, COL_GAP: 190, CARD_H: 116, PAD_X: 40, HEAD_H: 64,
    SP: 24,           // spacing between neighbouring anchor points on a spine, and from the outer ones to the cards
    HOVER_ZONE: 28,   // px from a card's left/right edge, or from the spine, in which anchor points appear
    SNAP_ZONE: 56,    // px around a column in which a dragged link snaps to it
  });
  L.GAP = 2 * L.SP;             // a gap with a single (unused) anchor point
  L.PITCH = L.CARD_H + L.GAP;
  L.PAD_TOP = 10;

  let scroller, heads, canvas, overlay, gLinks, gHover, gDrag;
  const cols = new Map();          // edition id -> { root, cards: Map(index -> node), chap }
  let counts = new Map();          // 'ed|ch|block' -> number of links touching the block
  let drag = null;                 // active link drag
  let mover = null;                // active block move
  let hoverKey = '';
  let suppressClick = false;

  const colX = (ci) => L.PAD_X + ci * (L.COL_W + L.COL_GAP);
  const stageW = () => {
    const n = Math.max(1, S.editions.length);
    return L.PAD_X * 2 + n * L.COL_W + (n - 1) * L.COL_GAP;
  };
  const chapOf = (ed) => ed.chapters[S.chapter];

  /*
   * Layout of one column. A gap holds a row of anchor points on the spine, evenly spaced: SP between
   * neighbours and SP between the outer points and the blocks above/below. With k points the gap is
   * (k + 1) * SP tall, so every point always keeps the same room around it, however many there are.
   *
   * A block can also be pulled down by the user: that adds `stretch` px to the gap above it, and the
   * points are then spread evenly over the taller gap.
   *
   * An untouched gap has one point (slot 0). A used slot spawns one more point on each side of it
   * (slot - 1, slot + 1), so after linking a point the gap grows by two spacings.
   *
   * Per edition+chapter we keep
   *   Hb[k]   height of the gap above block k      (k = 0..n; Hb[n] is the gap after the last block)
   *   tops[k] y of the top of block k              (tops[n] = end of the last gap)
   *   vis     Map(k -> sorted slots shown on that gap); gaps not in the map show [0]
   * Gap g ("after block g", g = -1..n-1) is gap k = g + 1.
   */
  let layouts = new Map();
  function lay(ed) {
    let ly = layouts.get(ed.id);
    if (ly) return ly;
    const c = chapOf(ed), n = c ? c.blocks.length : 0;
    const Hb = new Float64Array(n + 1).fill(L.GAP);
    const vis = new Map();
    if (c) {
      const used = new Map();
      for (const lk of S.links) {
        for (const e of [lk.a, lk.b]) {
          if (e.kind !== 'gap' || e.ed !== ed.id || e.ch !== S.chapter) continue;
          const k = e.ref === '^' ? 0 : c.idx.has(e.ref) ? c.idx.get(e.ref) + 1 : -1;
          if (k < 0) continue;
          if (!used.has(k)) used.set(k, new Set([0]));
          const u = used.get(k), sl = e.slot || 0;
          u.add(sl - 1); u.add(sl); u.add(sl + 1);
        }
      }
      for (const [k, set] of used) {
        const arr = [...set].sort((x, y) => x - y);
        vis.set(k, arr);
        Hb[k] = (arr.length + 1) * L.SP;
      }
    }
    // blocks the user has pulled down: extra space above them (never negative)
    const st = S.stretch[ed.id + '|' + S.chapter];
    if (c && st) for (const id in st) { const i = c.idx.get(id); if (i != null) Hb[i] += st[id]; }
    const tops = new Float64Array(n + 1);
    let y = L.PAD_TOP;
    for (let k = 0; k <= n; k++) { y += Hb[k]; tops[k] = y; y += L.CARD_H; }
    ly = { n, Hb, tops, vis };
    layouts.set(ed.id, ly);
    return ly;
  }
  const topOf = (ed, i) => lay(ed).tops[i];
  /* first k in 0..n with tops[k] >= v (n + 1 if none) */
  function lowerBound(ly, v) {
    let lo = 0, hi = ly.n + 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ly.tops[m] >= v) hi = m; else lo = m + 1; }
    return lo;
  }
  /* largest block index whose top is <= y, or -1 */
  function indexAt(ly, y) {
    let lo = 0, hi = ly.n + 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ly.tops[m] > y) hi = m; else lo = m + 1; }
    return Math.min(lo - 1, ly.n - 1);
  }
  const keyOf = (ed, ch, block) => ed + '|' + ch + '|' + block;

  const TYPE_LABEL = {
    'dn-verse': 'DN', 'bg-verse': 'BG', 'chapter-end': 'chapter end',
    'heading': 'heading', 'epilogue-verse': 'epilogue', 'epilogue-note': 'epilogue note',
  };

  /* ---------- anchors ---------- */
  /*
   * Two kinds of anchor:
   *  - block: on the left/right edge of a card, vertically centred   {kind:'block', ref:blockId, side:'L'|'R'}
   *  - gap:   on the spine between two cards (or before the first / after the last)
   *           {kind:'gap', ref:blockId above | '^', slot:-2..2}; slot 0 is the middle of the gap and
   *           further slots are stacked above (-) and below (+) it.
   */
  function mkBlock(ed, ref, side) { return { ed: ed.id, ch: S.chapter, kind: 'block', ref, side }; }
  function mkGap(ed, ref, slot) { return { ed: ed.id, ch: S.chapter, kind: 'gap', ref, slot }; }

  /* canvas-space position of an anchor, or null if its block isn't in the current chapter.
     For gap anchors `dir` is a placeholder; see faceEachOther(). */
  D.anchorPos = function (a) {
    if (a.ch !== S.chapter) return null;
    const ci = S.editions.findIndex((e) => e.id === a.ed);
    if (ci < 0) return null;
    const ed = S.editions[ci], c = chapOf(ed);
    if (!c) return null;
    if (a.kind === 'block') {
      const i = c.idx.get(a.ref);
      if (i == null) return null;
      return { x: colX(ci) + (a.side === 'R' ? L.COL_W : 0), y: topOf(ed, i) + L.CARD_H / 2, dir: a.side === 'R' ? 1 : -1, ci, ed };
    }
    let k = 0;                       // the gap above block k
    if (a.ref !== '^') {
      const i = c.idx.get(a.ref);
      if (i == null) return null;
      k = i + 1;
    }
    const ly = lay(ed), slots = ly.vis.get(k) || [0];
    let rank = slots.indexOf(a.slot || 0);
    if (rank < 0) rank = Math.floor((slots.length - 1) / 2);      // not shown (stale slot): use the middle
    return { x: colX(ci) + L.COL_W / 2, y: ly.tops[k] - ly.Hb[k] + (rank + 1) * ly.Hb[k] / (slots.length + 1), dir: 1, ci, ed };
  };

  /* A link leaves a spine anchor horizontally, towards whichever side the other end is on. */
  function faceEachOther(A, B) {
    const a = Object.assign({}, A), b = Object.assign({}, B);
    if (A.gap) a.dir = B.x >= A.x ? 1 : -1;
    if (B.gap) b.dir = A.x >= B.x ? 1 : -1;
    return [a, b];
  }
  function posOf(anchor) {
    const p = D.anchorPos(anchor);
    if (p) p.gap = anchor.kind === 'gap';
    return p;
  }

  /* the slots currently shown on gap g (after block g; -1 = before the first block) */
  function slotsOf(ed, g) { return lay(ed).vis.get(g + 1) || [0]; }

  /* index g of the gap (g = -1 .. n-1, "after block g") whose spine segment contains canvas y, else null */
  function gapAt(ed, y, pad) {
    if (!chapOf(ed)) return null;
    const ly = lay(ed);
    pad = pad || 0;
    const k = lowerBound(ly, y - pad);
    if (k > ly.n || y < ly.tops[k] - ly.Hb[k] - pad) return null;
    return k - 1;
  }
  const gapRef = (ed, g) => (g < 0 ? '^' : chapOf(ed).blocks[g].block_id);

  /* the block nearest to canvas y, or null if y is outside the chain */
  function blockAt(ed, y) {
    const c = chapOf(ed);
    if (!c || !c.blocks.length) return null;
    const ly = lay(ed);
    if (y < ly.tops[0] - ly.Hb[0] || y > ly.tops[ly.n]) return null;
    const i = indexAt(ly, y);
    if (i < 0) return 0;
    if (i + 1 < ly.n && Math.abs(y - (ly.tops[i + 1] + L.CARD_H / 2)) < Math.abs(y - (ly.tops[i] + L.CARD_H / 2))) return i + 1;
    return i;
  }

  function nearestByY(anchors, y) {
    let best = null, bd = Infinity;
    for (const a of anchors) {
      const p = D.anchorPos(a);
      if (!p) continue;
      const d = Math.abs(p.y - y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  /* ---------- geometry for bezier ---------- */
  function pathD(A, B) {
    const dx = Math.max(70, Math.abs(B.x - A.x) * 0.5);
    return `M ${A.x} ${A.y} C ${A.x + A.dir * dx} ${A.y}, ${B.x + B.dir * dx} ${B.y}, ${B.x} ${B.y}`;
  }

  /* ---------- rendering ---------- */
  function bodyHeight() {
    let h = 0;
    for (const ed of S.editions) h = Math.max(h, lay(ed).tops[lay(ed).n]);
    return Math.max(h + 160, scroller.clientHeight - L.HEAD_H);
  }

  function btn(label, title, fn, cls) {
    return el('button', { class: 'btn tiny ' + (cls || ''), title, onclick: (e) => { e.stopPropagation(); fn(e); } }, label);
  }

  function renderHeads() {
    heads.style.width = stageW() + 'px';
    heads.textContent = '';
    S.editions.forEach((ed, ci) => {
      const c = chapOf(ed);
      const dn = c ? c.blocks.filter((b) => b.block_type === 'dn-verse').length : 0;
      heads.append(el('div', { class: 'head', style: `left:${colX(ci)}px;width:${L.COL_W}px` },
        el('div', { class: 'head-top' },
          el('span', {
            class: 'head-name', title: ed.source ? ed.name + ' — ' + ed.source + '  (click to rename)' : 'Click to rename',
            onclick: () => {
              const n = prompt('Edition name', ed.name);
              if (n && n.trim()) { ed.name = n.trim(); S.edMeta[ed.id] = { name: ed.name }; D.emit(); }
            },
          }, ed.name),
          el('span', { class: 'head-btns' },
            btn('◀', 'Move column left', () => { D.moveEdition(ed.id, -1); D.emit(); }),
            btn('▶', 'Move column right', () => { D.moveEdition(ed.id, 1); D.emit(); }),
            btn('✕', 'Remove this edition from the view (links are kept)', () => {
              if (confirm('Remove "' + ed.name + '" from the view?\nIts links are kept and come back if you load it again.')) {
                D.removeEdition(ed.id); D.emit();
              }
            }, 'danger'))),
        el('div', { class: 'head-sub' }, c ? `Chapter ${S.chapter} · ${c.blocks.length} blocks · ${dn} ovi` : `no chapter ${S.chapter} in this edition`)));
    });
  }

  function makeCard(ed, c, i) {
    const b = c.blocks[i];
    const node = el('div', { class: 'card t-' + b.block_type, 'data-i': i, 'data-ed': ed.id },
      el('div', { class: 'card-head' },
        el('span', { class: 'bid' }, b.block_id),
        el('span', { class: 'btype' }, TYPE_LABEL[b.block_type] || b.block_type),
        el('span', { class: 'lcount' })),
      el('div', { class: 'card-text', lang: 'mr' }, b.block_text));
    node._chain = el('div', { class: 'chain' });                         // spine below this block
    node.append(node._chain);
    if (i === 0) { node._pre = el('div', { class: 'chain pre' }); node.append(node._pre); }   // spine above the first block
    return node;
  }

  function updateCard(node, ed, c, i) {
    const b = c.blocks[i];
    const sel = S.selected;
    const isSel = sel && sel.type === 'block' && sel.ed === ed.id && sel.ch === S.chapter && sel.block === b.block_id;
    node.classList.toggle('sel', !!isSel);
    node.classList.toggle('end-sel', endSelKeys.has(keyOf(ed.id, S.chapter, b.block_id)));
    node.classList.toggle('drop', !!(drag && drag.snap && drag.snap.kind === 'block' && drag.snap.ed === ed.id && drag.snap.ref === b.block_id));
    const ly = lay(ed);
    node._chain.style.height = ly.Hb[i + 1] + 'px';
    if (node._pre) node._pre.style.height = ly.Hb[0] + 'px';
    const n = counts.get(keyOf(ed.id, S.chapter, b.block_id)) || 0;
    const badge = node.firstChild.lastChild;
    const txt = n ? String(n) : '';
    if (badge.textContent !== txt) badge.textContent = txt;
  }

  let endSelKeys = new Set();

  function renderColumns() {
    const sr = scroller.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    const visTop = sr.top - cr.top - 240, visBot = sr.bottom - cr.top + 240;
    canvas.style.height = bodyHeight() + 'px';
    canvas.style.width = stageW() + 'px';
    overlay.setAttribute('width', stageW());
    overlay.setAttribute('height', bodyHeight());

    for (const [id, c] of cols) {
      if (!S.editions.some((e) => e.id === id)) { c.root.remove(); cols.delete(id); }
    }
    S.editions.forEach((ed, ci) => {
      let col = cols.get(ed.id);
      if (!col) {
        col = { root: el('div', { class: 'col' }), cards: new Map(), chap: undefined };
        canvas.appendChild(col.root);
        cols.set(ed.id, col);
      }
      col.root.style.left = colX(ci) + 'px';
      const chap = chapOf(ed) || null;
      if (col.chap !== chap) {
        col.root.textContent = '';
        col.cards.clear();
        col.chap = chap;
        if (!chap) col.root.append(el('div', { class: 'col-empty' }, `This edition has no chapter ${S.chapter}.`));
      }
      if (!chap) return;
      const ly = lay(ed);
      const i0 = Math.max(0, indexAt(ly, visTop));
      const i1 = Math.min(ly.n - 1, indexAt(ly, visBot));
      for (const [i, node] of col.cards) {
        if (i < i0 || i > i1) { node.remove(); col.cards.delete(i); }
      }
      for (let i = i0; i <= i1; i++) {
        let node = col.cards.get(i);
        if (!node) { node = makeCard(ed, chap, i); col.root.appendChild(node); col.cards.set(i, node); }
        node.style.top = topOf(ed, i) + 'px';
        updateCard(node, ed, chap, i);
      }
    });
  }

  function renderLinks() {
    gLinks.textContent = '';
    counts = new Map();
    endSelKeys = new Set();
    let hidden = 0, shown = 0;
    const selId = S.selected && S.selected.type === 'link' ? S.selected.id : null;
    for (const lk of S.links) {
      if (lk.a.ch !== S.chapter && lk.b.ch !== S.chapter) continue;
      const pa = posOf(lk.a), pb = posOf(lk.b);
      if (!pa || !pb) { hidden++; continue; }
      const [A, B] = faceEachOther(pa, pb);
      shown++;
      for (const e of [lk.a, lk.b]) {
        if (e.kind === 'block') {
          const k = keyOf(e.ed, e.ch, e.ref);
          counts.set(k, (counts.get(k) || 0) + 1);
          if (lk.id === selId) endSelKeys.add(k);
        }
      }
      const d = pathD(A, B);
      gLinks.append(svg('g', { class: 'lk rel-' + lk.rel + (lk.id === selId ? ' sel' : ''), 'data-id': lk.id },
        svg('path', { d, class: 'hit' }),
        svg('path', { d, class: 'line' }),
        svg('circle', { cx: A.x, cy: A.y, r: 5, class: 'end' }),
        svg('circle', { cx: B.x, cy: B.y, r: 5, class: 'end' })));
    }
    D.linkStats = { shown, hidden };
  }

  /* hover anchor points */
  function renderHover(anchors) {
    const key = anchors.map((a) => [a.ed, a.kind, a.ref, a.side, a.slot].join('/')).join(';') + '@' + S.chapter;
    if (key === hoverKey) return;
    hoverKey = key;
    gHover.textContent = '';
    for (const a of anchors) {
      const p = D.anchorPos(a);
      if (!p) continue;
      const title = a.kind === 'block' ? 'Drag to link this block' : 'Drag to link to this point between blocks (insertion / omission)';
      const dot = svg('circle', { cx: p.x, cy: p.y, r: 8, class: 'dot' }, svg('title', {}, title));
      dot.addEventListener('mousedown', (e) => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); startDrag(a, e); } });
      gHover.append(dot);
    }
  }
  function clearHover() { hoverKey = ''; gHover.textContent = ''; }

  function hoverAt(x, y) {
    const out = [];
    S.editions.forEach((ed, ci) => {
      const c = chapOf(ed);
      if (!c) return;
      const cx = colX(ci);
      // on the spine between blocks: the gap's anchor points (more appear next to used ones)
      if (Math.abs(x - (cx + L.COL_W / 2)) <= L.HOVER_ZONE) {
        const g = gapAt(ed, y, 4);
        if (g !== null) {
          const ref = gapRef(ed, g);
          for (const sl of slotsOf(ed, g)) out.push(mkGap(ed, ref, sl));
        }
      }
      // at a card's left/right edge: the block's anchor point
      let side = null;
      if (Math.abs(x - cx) <= L.HOVER_ZONE) side = 'L';
      else if (Math.abs(x - (cx + L.COL_W)) <= L.HOVER_ZONE) side = 'R';
      if (side) {
        const j = blockAt(ed, y);
        if (j != null) out.push(mkBlock(ed, c.blocks[j].block_id, side));
      }
    });
    return out;
  }

  /* ---------- drag to link ---------- */
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function startDrag(anchor, e) {
    const pos = posOf(anchor);
    if (!pos) return;
    const p = toCanvas(e);
    drag = { from: anchor, pos, x: p.x, y: p.y, cx: e.clientX, cy: e.clientY, snap: null, cands: [], raf: 0 };
    document.body.classList.add('dragging');
    clearHover();
    drag.upd = updateDrag;
    updateDrag();
    drag.raf = requestAnimationFrame(autoscroll);
  }

  function snapAt(x, y) {
    if (!drag) return { snap: null, cands: [] };
    for (let ci = 0; ci < S.editions.length; ci++) {
      const ed = S.editions[ci];
      if (ed.id === drag.from.ed) continue;
      const cx = colX(ci);
      if (x < cx - L.SNAP_ZONE || x > cx + L.COL_W + L.SNAP_ZONE) continue;
      // between two blocks: snap to a point on the spine (never from one spine point to another)
      const g = drag.from.kind === 'gap' ? null : gapAt(ed, y, 6);
      if (g !== null) {
        const ref = gapRef(ed, g);
        const cands = slotsOf(ed, g).map((sl) => mkGap(ed, ref, sl));
        return { snap: nearestByY(cands, y), cands };
      }
      // on a card: snap to its edge
      const j = blockAt(ed, y);
      if (j == null) continue;
      let side;
      if (x < cx + L.HOVER_ZONE) side = 'L';
      else if (x > cx + L.COL_W - L.HOVER_ZONE) side = 'R';
      else side = drag.pos.x < cx ? 'L' : 'R';   // inside the card: face the origin
      const a = mkBlock(ed, chapOf(ed).blocks[j].block_id, side);
      return { snap: a, cands: [a] };
    }
    return { snap: null, cands: [] };
  }

  function updateDrag() {
    const s = snapAt(drag.x, drag.y);
    drag.snap = s.snap;
    drag.cands = s.cands;
    gDrag.textContent = '';
    const A0 = drag.pos;
    let end = null;
    for (const a of drag.cands) {
      const p = D.anchorPos(a);
      if (p) gDrag.append(svg('circle', { cx: p.x, cy: p.y, r: 5, class: 'cand' }));
    }
    if (drag.snap) {
      end = posOf(drag.snap);
      if (end) gDrag.append(svg('circle', { cx: end.x, cy: end.y, r: 13, class: 'snap-ring' }));
    }
    let A, B;
    if (end) [A, B] = faceEachOther(A0, end);
    else {
      A = Object.assign({}, A0);
      if (A0.gap) A.dir = drag.x >= A0.x ? 1 : -1;
      B = { x: drag.x, y: drag.y, dir: A.dir > 0 ? -1 : 1 };
    }
    gDrag.prepend(svg('path', { d: pathD(A, B), class: 'drag-line' }));
    gDrag.append(svg('circle', { cx: A0.x, cy: A0.y, r: 6, fill: '#6b5b45' }));
    renderColumns();   // refreshes the .drop highlight (cheap: only visible cards)
  }

  /* edge auto-scroll while dragging a link or moving a block */
  function autoscroll() {
    const act = drag || mover;
    if (!act) return;
    const r = scroller.getBoundingClientRect();
    const m = 70, top = r.top + L.HEAD_H + m;
    let dy = 0, dx = 0;
    if (act.cy < top) dy = -Math.min(34, (top - act.cy) / 3 + 2);
    else if (act.cy > r.bottom - m) dy = Math.min(34, (act.cy - (r.bottom - m)) / 3 + 2);
    if (act.cx < r.left + m) dx = -Math.min(30, (r.left + m - act.cx) / 3 + 2);
    else if (act.cx > r.right - m) dx = Math.min(30, (act.cx - (r.right - m)) / 3 + 2);
    if (dx || dy) {
      scroller.scrollTop += dy;
      scroller.scrollLeft += dx;
      const p = toCanvas({ clientX: act.cx, clientY: act.cy });
      act.x = p.x; act.y = p.y;
      act.upd();
    }
    act.raf = requestAnimationFrame(autoscroll);
  }

  /* ---------- moving a block (stretches the chain above it) ---------- */
  function setStretch(ed, blockId, px) {
    const key = ed.id + '|' + S.chapter;
    const st = S.stretch[key] || (S.stretch[key] = {});
    if (px < 1) delete st[blockId]; else st[blockId] = Math.round(px);
    if (!Object.keys(st).length) delete S.stretch[key];
  }
  function relayout() {
    layouts = new Map();
    renderLinks();
    renderColumns();
  }
  function startMove(card, e) {
    const ed = D.edById(card.getAttribute('data-ed'));
    const c = ed && chapOf(ed);
    const b = c && c.blocks[+card.getAttribute('data-i')];
    if (!b) return;
    const st = S.stretch[ed.id + '|' + S.chapter];
    const p = toCanvas(e);
    mover = { ed, id: b.block_id, y0: p.y, extra0: (st && st[b.block_id]) || 0, x: p.x, y: p.y, cx: e.clientX, cy: e.clientY, moved: false, raf: 0, upd: updateMove };
    mover.raf = requestAnimationFrame(autoscroll);
  }
  function updateMove() {
    if (!mover.moved) {
      if (Math.abs(mover.y - mover.y0) < 4) return;       // still a click
      mover.moved = true;
      document.body.classList.add('moving');
      clearHover();
    }
    // never above its natural place (extra >= 0); moving down stretches the link above it
    setStretch(mover.ed, mover.id, Math.max(0, mover.extra0 + mover.y - mover.y0));
    relayout();
  }
  function endMove(cancel) {
    if (!mover) return;
    cancelAnimationFrame(mover.raf);
    const m = mover;
    mover = null;
    document.body.classList.remove('moving');
    if (!m.moved) return;
    if (cancel) setStretch(m.ed, m.id, m.extra0);
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    D.emit();
  }

  function endDrag(commit) {
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    const d = drag;
    drag = null;
    document.body.classList.remove('dragging');
    gDrag.textContent = '';
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (commit && d.snap && d.snap.ed !== d.from.ed && !(d.from.kind === 'gap' && d.snap.kind === 'gap')) {
      const lk = D.addLink(d.from, d.snap);
      if (lk) {
        S.selected = { type: 'link', id: lk.id };
        D.toast('Linked — set the relation in the details panel');
      } else {
        D.toast('Those two are already linked', true);
      }
    }
    D.emit();
  }

  /* ---------- selection helpers ---------- */
  D.scrollToAnchor = function (a) {
    if (a.ch !== S.chapter) { S.chapter = a.ch; D.emit(); }
    const p = D.anchorPos(a);
    if (p) scroller.scrollTop = Math.max(0, L.HEAD_H + p.y - scroller.clientHeight / 2);
  };

  /* ---------- main render ---------- */
  D.render = function () {
    if (!scroller) return;
    layouts = new Map();   // links / stretches / chapter may have changed
    $('empty').classList.toggle('show', S.editions.length === 0);
    renderHeads();
    renderLinks();     // first: computes badge counts / selected-end highlights
    renderColumns();
    if (D.renderPanel) D.renderPanel();
    if (D.renderToolbar) D.renderToolbar();
  };

  D.initView = function () {
    scroller = $('scroller'); heads = $('heads'); canvas = $('canvas'); overlay = $('overlay');
    gLinks = $('gLinks'); gHover = $('gHover'); gDrag = $('gDrag');
    document.documentElement.style.setProperty('--head-h', L.HEAD_H + 'px');

    let ticking = false;
    scroller.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; renderColumns(); });
    });
    window.addEventListener('resize', () => renderColumns());

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || drag || mover) return;
      const card = e.target.closest && e.target.closest('.card');
      if (!card) return;
      e.preventDefault();
      startMove(card, e);
    });
    canvas.addEventListener('mousemove', (e) => {
      if (drag || mover) return;
      const p = toCanvas(e);
      renderHover(hoverAt(p.x, p.y));
    });
    canvas.addEventListener('mouseleave', () => { if (!drag && !mover) clearHover(); });

    window.addEventListener('mousemove', (e) => {
      if (mover) {
        mover.cx = e.clientX; mover.cy = e.clientY;
        const p = toCanvas(e);
        mover.x = p.x; mover.y = p.y;
        updateMove();
        return;
      }
      if (!drag) return;
      drag.cx = e.clientX; drag.cy = e.clientY;
      const p = toCanvas(e);
      drag.x = p.x; drag.y = p.y;
      updateDrag();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      if (mover) endMove(false);
      else if (drag) endDrag(true);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (mover) endMove(true);
        else if (drag) endDrag(false);
        else if (S.selected) D.select(null);
        return;
      }
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected && S.selected.type === 'link') {
        e.preventDefault();
        D.removeLink(S.selected.id);
        D.emit();
      }
    });

    canvas.addEventListener('click', (e) => {
      if (suppressClick) return;
      const hit = e.target.closest && e.target.closest('.lk');
      if (hit) { D.select({ type: 'link', id: hit.getAttribute('data-id') }); return; }
      const card = e.target.closest && e.target.closest('.card');
      if (card) {
        const ed = D.edById(card.getAttribute('data-ed'));
        const b = ed && chapOf(ed).blocks[+card.getAttribute('data-i')];
        if (b) D.select({ type: 'block', ed: ed.id, ch: S.chapter, block: b.block_id });
        return;
      }
      if (S.selected) D.select(null);
    });
  };
})(window.DCE);
