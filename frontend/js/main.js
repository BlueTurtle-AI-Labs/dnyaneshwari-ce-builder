/* Toolbar, file loading, demo data and start-up. */
(function (D) {
  'use strict';
  const S = D.state, $ = D.$;

  /* ---------- toolbar ---------- */
  D.renderToolbar = function () {
    const sel = $('chapterSel');
    const list = D.chapterList();
    const want = list.map((c) => c.num + '|' + c.title).join(';');
    if (sel.dataset.sig !== want) {
      sel.textContent = '';
      for (const c of list) sel.append(D.el('option', { value: c.num }, `${c.num}. ${c.title}`));
      sel.dataset.sig = want;
    }
    sel.value = String(S.chapter);
    sel.disabled = list.length === 0;
    $('prevCh').disabled = $('nextCh').disabled = list.length === 0;
    $('demoEd').disabled = S.editions.length === 0;
  };

  function gotoChapter(n) {
    S.chapter = n;
    S.selected = null;
    $('scroller').scrollTop = 0;
    D.emit();
  }
  function stepChapter(d) {
    const list = D.chapterList();
    const i = list.findIndex((c) => c.num === S.chapter);
    const j = D.clamp((i < 0 ? 0 : i) + d, 0, list.length - 1);
    if (list[j]) gotoChapter(list[j].num);
  }

  /* ---------- loading editions ---------- */
  function afterLoad() {
    const list = D.chapterList();
    if (list.length && !list.some((c) => c.num === S.chapter)) S.chapter = list[0].num;
    D.emit();
  }

  async function loadFiles(files) {
    let ok = 0;
    for (const f of files) {
      try {
        const json = JSON.parse(await f.text());
        const ed = D.addEdition(json, f.name);
        D.toast(`Loaded “${ed.name}”`);
        ok++;
      } catch (e) {
        D.toast(`${f.name}: ${e.message}`, true);
      }
    }
    if (ok) afterLoad();
  }

  /* ---------- demo: a perturbed copy of the first edition ---------- */
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeVariant(ed, n) {
    const rand = rng(1234 + n * 77);
    const chapters = [];
    for (const num of Object.keys(ed.chapters).map(Number).sort((a, b) => a - b)) {
      const c = ed.chapters[num];
      const blocks = [];
      for (const b of c.blocks) {
        if (b.block_type === 'dn-verse' && rand() < 0.08) continue;           // omitted verse
        let text = b.block_text;
        if (rand() < 0.15) {                                                   // variant reading
          const w = text.split(' ');
          const k = Math.floor(rand() * w.length);
          if (rand() < 0.5 && w.length > 4) w.splice(k, 1);
          else w[k] = [...w[k]].slice(0, Math.max(1, [...w[k]].length - 1)).join('');
          text = w.join(' ');
        }
        blocks.push({ block_id: '', block_type: b.block_type, block_text: text });
      }
      blocks.forEach((b, i) => { b.block_id = D.pad(num, 2) + '-' + D.pad(i + 1, 4); });
      chapters.push({
        chapter_number: num, chapter_title: c.title, blocks,
        total_num_blocks: blocks.length, total_dn_verses: blocks.filter((b) => b.block_type === 'dn-verse').length,
      });
    }
    return { book_name: 'Dnyaneshwari', edition: 'Synthetic demo variant of ' + ed.name, chapters };
  }

  /* ---------- wiring ---------- */
  function init() {
    D.loadState();
    D.initView();

    $('addEd').onclick = $('emptyAdd').onclick = () => $('fileIn').click();
    $('fileIn').onchange = (e) => { loadFiles([...e.target.files]); e.target.value = ''; };
    $('prevCh').onclick = () => stepChapter(-1);
    $('nextCh').onclick = () => stepChapter(1);
    $('chapterSel').onchange = (e) => gotoChapter(+e.target.value);
    $('togglePanel').onclick = () => { $('panel').classList.toggle('hidden'); setTimeout(() => D.render(), 0); };

    $('demoEd').onclick = () => {
      if (!S.editions.length) return;
      const n = S.editions.filter((e) => e.id.startsWith('demo-variant')).length + 1;
      const json = makeVariant(S.editions[0], n);
      D.addEdition(json, 'demo-variant-' + n + '.json');
      D.toast('Added a synthetic variant with omitted verses and altered words');
      afterLoad();
    };

    $('exportLinks').onclick = () => {
      if (!S.links.length) { D.toast('No links to export yet', true); return; }
      D.download('dnyaneshwari_links.json', D.exportLinks());
    };
    $('importLinks').onclick = () => $('importIn').click();
    $('importIn').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const added = D.importLinks(await f.text());
        D.toast(`Imported ${added} link${added === 1 ? '' : 's'}`);
        D.emit();
      } catch (err) { D.toast(`Import failed: ${err.message}`, true); }
    };

    // drag & drop JSON files anywhere
    window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      loadFiles([...e.dataTransfer.files].filter((f) => /\.json$/i.test(f.name)));
    });

    D.render();
    if (D.droppedLinks) {
      D.toast(D.droppedLinks + ' saved link' + (D.droppedLinks === 1 ? '' : 's') + ' between two in-between points removed (not allowed)', true);
    }

    // When served over http from the repo root, load the converted edition automatically.
    if (/^https?:$/.test(location.protocol)) {
      fetch('../parsed_data/dnyaneshwari_edition1.json')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((json) => { D.addEdition(json, 'dnyaneshwari_edition1.json'); afterLoad(); })
        .catch(() => { /* not available: user loads files manually */ });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.DCE);
