/* Application state, edition loading, link model and persistence. */
(function (D) {
  'use strict';
  const KEY = 'dce.v1';

  /*
   * Anchor (one end of a link):
   *   { ed, ch, kind: 'block', ref: <block_id>,            side: 'L'|'R' }  -> a block
   *   { ed, ch, kind: 'gap',   ref: <block_id above>|'^',  slot: integer }   -> a point on the spine after that block ('^' = before first)
   * Link: { id, a: Anchor, b: Anchor, rel, note, created }
   */
  const S = (D.state = {
    editions: [],      // loaded editions, in column order
    chapter: 1,
    links: [],         // persisted
    edMeta: {},        // edition id -> { name }   persisted
    stretch: {},       // 'edId|chapter' -> { blockId: px extra gap above that block }   persisted
    edOrder: [],       // persisted column order
    selected: null,    // { type: 'link', id } | { type: 'block', ed, ch, block }
  });

  D.RELATIONS = [
    { key: 'equivalent', label: 'Equivalent', hint: 'same verse, same reading' },
    { key: 'variant', label: 'Variant reading', hint: 'same verse, different wording' },
    { key: 'partial', label: 'Partial', hint: 'overlaps only part of the other block' },
    { key: 'transposed', label: 'Transposed', hint: 'same text, different position' },
    { key: 'insertion', label: 'Insertion / omission', hint: 'text present in one edition only (use the points between blocks)' },
    { key: 'uncertain', label: 'Uncertain', hint: 'tentative mapping' },
  ];

  /* ---------- persistence ---------- */
  function load() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!j) return;
      S.links = Array.isArray(j.links) ? j.links : [];
      const before = S.links.length;
      S.links = S.links.filter((l) => !(l.a && l.b && l.a.kind === 'gap' && l.b.kind === 'gap'));
      D.droppedLinks = before - S.links.length;
      S.edMeta = j.edMeta || {};
      S.stretch = j.stretch || {};
      S.chapter = j.chapter || 1;
      S.edOrder = j.edOrder || [];
    } catch (e) { /* ignore corrupt storage */ }
  }
  let saveTimer = null;
  D.save = function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const order = S.editions.map((e) => e.id).concat(S.edOrder.filter((id) => !S.editions.some((e) => e.id === id)));
        localStorage.setItem(KEY, JSON.stringify({
          links: S.links.filter((l) => l.created !== 'auto'), edMeta: S.edMeta, stretch: S.stretch, chapter: S.chapter, edOrder: order,
        }));
      } catch (e) { /* storage full / disabled */ }
    }, 150);
  };
  D.emit = function () { D.save(); if (D.render) D.render(); };
  D.loadState = load;

  /* ---------- editions ---------- */
  D.addEdition = function (json, fileName) {
    if (!json || !Array.isArray(json.chapters)) throw new Error('not a Dnyaneshwari JSON (missing "chapters")');
    const base = (fileName || 'edition').replace(/\.[^.]+$/, '') || 'edition';
    let id = base, k = 2;
    while (S.editions.some((e) => e.id === id)) id = base + '-' + k++;

    const chapters = {};
    for (const c of json.chapters) {
      const blocks = Array.isArray(c.blocks) ? c.blocks : [];
      const idx = new Map();
      blocks.forEach((b, i) => idx.set(b.block_id, i));
      chapters[c.chapter_number] = { num: c.chapter_number, title: c.chapter_title || '', blocks, idx };
    }
    const ed = {
      id, name: (S.edMeta[id] && S.edMeta[id].name) || base,
      source: json.edition || '', chapters,
    };
    S.editions.push(ed);
    const pos = (e) => { const i = S.edOrder.indexOf(e.id); return i < 0 ? 1e9 : i; };
    S.editions.sort((x, y) => pos(x) - pos(y));
    return ed;
  };

  D.removeEdition = function (id) {
    S.editions = S.editions.filter((e) => e.id !== id);
    if (S.selected && S.selected.ed === id) S.selected = null;
  };

  D.moveEdition = function (id, dir) {
    const i = S.editions.findIndex((e) => e.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= S.editions.length) return;
    [S.editions[i], S.editions[j]] = [S.editions[j], S.editions[i]];
  };

  D.chapterList = function () {
    const m = new Map();
    for (const ed of S.editions) for (const n in ed.chapters) {
      if (!m.has(+n)) m.set(+n, ed.chapters[n].title);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([num, title]) => ({ num, title }));
  };

  D.edById = (id) => S.editions.find((e) => e.id === id);
  D.edName = (id) => { const e = D.edById(id); return e ? e.name : (S.edMeta[id] && S.edMeta[id].name) || id; };

  /* ---------- links ---------- */
  D.uid = () => 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  D.sameEnd = (a, b) => a.ed === b.ed && a.ch === b.ch && a.kind === b.kind && a.ref === b.ref &&
    (a.kind !== 'gap' || (a.slot || 0) === (b.slot || 0));

  D.addLink = function (a, b) {
    if (a.kind === 'gap' && b.kind === 'gap') return null;   // a link needs a block at one end at least
    if (S.links.some((l) => (D.sameEnd(l.a, a) && D.sameEnd(l.b, b)) || (D.sameEnd(l.a, b) && D.sameEnd(l.b, a)))) return null;
    const rel = a.kind === 'gap' || b.kind === 'gap' ? 'insertion' : 'equivalent';
    const lk = { id: D.uid(), a, b, rel, note: '', created: new Date().toISOString() };
    S.links.push(lk);
    return lk;
  };
  D.removeLink = function (id) {
    S.links = S.links.filter((l) => l.id !== id);
    if (S.selected && S.selected.type === 'link' && S.selected.id === id) S.selected = null;
  };
  D.linkById = (id) => S.links.find((l) => l.id === id);

  D.select = function (sel) { S.selected = sel; D.emit(); };

  /* block object for a 'block' anchor, or null */
  D.blockOf = function (a) {
    const ed = D.edById(a.ed);
    const c = ed && ed.chapters[a.ch];
    if (!c || a.kind !== 'block') return null;
    const i = c.idx.get(a.ref);
    return i == null ? null : c.blocks[i];
  };

  /* ---------- import / export of mappings ---------- */
  D.exportLinks = function () {
    const used = new Set();
    S.links.forEach((l) => { used.add(l.a.ed); used.add(l.b.ed); });
    return JSON.stringify({
      format: 'dnyaneshwari-link-map', version: 1, exported: new Date().toISOString(),
      editions: [...used].map((id) => ({ id, name: D.edName(id) })),
      links: S.links,
    }, null, 2);
  };
  D.importLinks = function (text) {
    const j = JSON.parse(text);
    if (!j || j.format !== 'dnyaneshwari-link-map' || !Array.isArray(j.links)) throw new Error('not a link-map file');
    (j.editions || []).forEach((e) => { if (!S.edMeta[e.id]) S.edMeta[e.id] = { name: e.name }; });
    let added = 0;
    for (const l of j.links) {
      if (!l.a || !l.b || (l.a.kind === 'gap' && l.b.kind === 'gap') || S.links.some((x) => x.id === l.id)) continue;
      S.links.push(l);
      added++;
    }
    return added;
  };
})(window.DCE);
