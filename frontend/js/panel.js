/* Right-hand details panel: overview, selected block, selected link (with word diff). */
(function (D) {
  'use strict';
  const S = D.state, el = D.el, $ = D.$;

  const TYPE_NAMES = {
    'dn-verse': 'DN', 'bg-verse': 'BG', 'chapter-end': 'Chapter end',
    'heading': 'Heading', 'epilogue-verse': 'Epilogue verse', 'epilogue-note': 'Epilogue note',
  };

  function describe(a) {
    const who = D.edName(a.ed);
    if (a.kind === 'block') return { who, where: 'Block ' + a.ref + ' (chapter ' + a.ch + ')', block: D.blockOf(a) };
    const where = a.ref === '^' ? 'Between blocks: before the first block' : 'Between blocks: after ' + a.ref;
    const slot = a.slot ? ', point ' + (a.slot > 0 ? '+' : '') + a.slot : '';
    return { who, where: where + slot + ' (chapter ' + a.ch + ')', block: null };
  }

  function endpoint(a) {
    const d = describe(a);
    return el('div', { class: 'endpoint' },
      el('div', { class: 'who' }, d.who),
      el('div', { class: 'where' }, d.where + ' ',
        el('a', { href: '#', onclick: (e) => { e.preventDefault(); D.scrollToAnchor(a); } }, 'go to')),
      d.block ? el('div', { class: 'panel-text', lang: 'mr' }, d.block.block_text) : null);
  }

  function diffSpans(parts) {
    const box = el('div', { class: 'panel-text diff', lang: 'mr' });
    parts.forEach((p, i) => {
      if (i) box.append(' ');
      box.append(el('span', { class: p.c === 'same' ? '' : p.c }, p.t));
    });
    return box;
  }

  function linkView(lk) {
    const root = el('div');
    root.append(el('h3', {}, 'Link'));

    const sel = el('select', {
      onchange: (e) => { lk.rel = e.target.value; D.emit(); },
    }, ...D.RELATIONS.map((r) => el('option', { value: r.key, selected: r.key === lk.rel, title: r.hint }, r.label)));
    root.append(el('div', { class: 'row' }, el('label', {}, 'Relation'), sel));
    const hint = D.RELATIONS.find((r) => r.key === lk.rel);
    if (hint) root.append(el('p', { class: 'muted small' }, hint.hint));

    root.append(el('h4', {}, 'Between'), endpoint(lk.a), endpoint(lk.b));

    const A = D.blockOf(lk.a), B = D.blockOf(lk.b);
    if (A && B) {
      const df = D.wordDiff(A.block_text, B.block_text);
      root.append(
        el('h4', {}, 'Similarity'),
        el('p', { class: 'sim' }, el('b', {}, Math.round(df.sim * 100) + '%'),
          ` words in common (${df.common} of ${df.na} / ${df.nb})`),
        el('h4', {}, D.edName(lk.a.ed) + ' — differences'), diffSpans(df.a),
        el('h4', {}, D.edName(lk.b.ed) + ' — differences'), diffSpans(df.b),
        el('p', { class: 'muted small' }, 'Red = only in the first, green = only in the second.'));
    }

    root.append(el('h4', {}, 'Note'));
    const ta = el('textarea', { placeholder: 'Scholarly note about this mapping…' });
    ta.value = lk.note || '';
    ta.addEventListener('input', () => { lk.note = ta.value; D.save(); });
    root.append(ta);

    root.append(el('div', { class: 'row', style: 'margin-top:14px' },
      el('button', { class: 'btn danger', onclick: () => { D.removeLink(lk.id); D.emit(); } }, 'Delete link'),
      el('span', { class: 'muted small' }, 'or press ', el('span', { class: 'kbd' }, 'Del'))));
    return root;
  }

  function blockView(sel) {
    const ed = D.edById(sel.ed);
    const c = ed && ed.chapters[sel.ch];
    const i = c ? c.idx.get(sel.block) : null;
    const b = i == null ? null : c.blocks[i];
    const root = el('div');
    if (!b) { root.append(el('p', {}, 'Block not available.')); return root; }
    root.append(el('h3', {}, 'Block ' + b.block_id),
      el('p', { class: 'muted' }, ed.name + ' · ' + (TYPE_NAMES[b.block_type] || b.block_type) + ' · position ' + (i + 1) + ' of ' + c.blocks.length),
      el('div', { class: 'panel-text', lang: 'mr' }, b.block_text));

    const mine = S.links.filter((l) => [l.a, l.b].some((e) => e.kind === 'block' && e.ed === sel.ed && e.ch === sel.ch && e.ref === sel.block));
    root.append(el('h4', {}, 'Links (' + mine.length + ')'));
    if (!mine.length) root.append(el('p', { class: 'muted' }, 'None yet. Hover near the left or right edge of the block and drag from a point.'));
    const ul = el('ul', { class: 'linklist' });
    for (const l of mine) {
      const other = l.a.ed === sel.ed && l.a.ref === sel.block ? l.b : l.a;
      const d = describe(other);
      ul.append(el('li', { onclick: () => D.select({ type: 'link', id: l.id }) },
        el('span', { class: 'sw', style: `--c:var(--r-${l.rel})` }),
        el('b', {}, d.who), ' — ', other.kind === 'block' ? other.ref : (other.ref === '^' ? 'gap at start' : 'gap after ' + other.ref),
        el('div', { class: 'muted small' }, (D.RELATIONS.find((r) => r.key === l.rel) || {}).label)));
    }
    root.append(ul);
    return root;
  }

  function overview() {
    const root = el('div');
    const st = D.linkStats || { shown: 0, hidden: 0 };
    root.append(el('h3', {}, 'How to map blocks'));
    root.append(el('ol', { class: 'howto' },
      el('li', {}, 'Move the mouse near the ', el('b', {}, 'left or right edge'), ' of a block. Anchor points appear: a ● for the block itself and ◇ for the gaps just above and below it.'),
      el('li', {}, 'Press on a point and ', el('b', {}, 'drag'), ' to a block (or gap) of another edition. The target snaps in teal; release to create the link.'),
      el('li', {}, 'Click a link to set its relation, add a note, and see a word-by-word diff. ', el('span', { class: 'kbd' }, 'Del'), ' removes it.'),
      el('li', {}, 'Press on the middle of a block (hand cursor) and drag it down to stretch the chain above it, to make room. It can’t go above its natural place. Heights only show order within one edition; they don’t mean blocks on the same level are mapped.')));

    root.append(el('h4', {}, 'This chapter'));
    root.append(el('p', {}, `${st.shown} link${st.shown === 1 ? '' : 's'} shown` + (st.hidden ? `, ${st.hidden} hidden (edition not loaded or block missing)` : '') +
      ` · ${S.links.length} in total`));

    root.append(el('h4', {}, 'Relations'));
    const lg = el('div', { class: 'legend' });
    D.RELATIONS.forEach((r) => lg.append(el('div', {},
      el('span', { class: 'sw' + (r.key === 'uncertain' || r.key === 'insertion' ? ' dash' : ''), style: `--c:var(--r-${r.key})` }),
      el('b', {}, r.label), el('span', { class: 'muted small' }, ' — ' + r.hint))));
    root.append(lg);

    root.append(el('h4', {}, 'Block types'));
    const types = [['dn-verse', 'var(--t-dn)'], ['bg-verse', 'var(--t-bg)'], ['heading', 'var(--t-heading)'], ['chapter-end', 'var(--t-end)'], ['epilogue-verse', 'var(--t-epi)']];
    const tl = el('div', { class: 'legend' });
    types.forEach(([k, c]) => tl.append(el('div', {}, el('span', { class: 'sw', style: `--c:${c}` }), TYPE_NAMES[k])));
    root.append(tl);
    return root;
  }

  D.renderPanel = function () {
    const p = $('panel');
    const keepScroll = p.scrollTop;
    p.textContent = '';
    const sel = S.selected;
    let view = null;
    if (sel && sel.type === 'link') {
      const lk = D.linkById(sel.id);
      if (lk) view = linkView(lk);
    } else if (sel && sel.type === 'block') {
      view = blockView(sel);
    }
    p.append(view || overview());
    p.scrollTop = keepScroll;
  };
})(window.DCE);
