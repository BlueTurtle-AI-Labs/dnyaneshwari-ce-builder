# Critical Edition Builder (frontend)

Static site — no build step. Live: https://blueturtle-ai-labs.github.io/dnyaneshwari-ce-builder/frontend/

```
# from the repo root, so the bundled editions are auto-loaded:
python -m http.server 8000
# then open http://localhost:8000/frontend/
```
Opening `frontend/index.html` directly (file://) also works, but nothing is auto-loaded; use **+ Add edition** (or drag & drop) to load JSON files.

## Editions

When served over http(s), `js/main.js` fetches the editions listed in `BUNDLED_EDITIONS` (paths relative to the repo root, shown in this column order):

| Edition | File |
|---|---|
| Sansdocs | `parsed_data/sansdocs/dnyaneshwari_sansdocs.json` |
| Dandekar | `parsed_data/dandekar/dnyaneshwari_dandekar.json` |

**Links:** `parsed_data/links/sansdocs_dandekar_links.json` (made by `scripts/align_editions.py`) is imported on startup (`BUNDLED_LINKS`), so the two editions already come pre-linked: bg-verses and chapter-ends in order, ovis by text-similarity alignment (relation *Equivalent* if identical, *Variant reading* if the wording differs, *Uncertain* if weak). Each link carries a `sim` score (0–1); tick **Similarity** in the toolbar to show it on the links (green ≥ 90%, amber ≥ 75%, red below). Ovis without a counterpart stay unlinked. They are ordinary links: edit or delete them freely. Auto links are not stored in the browser; edited ones are, and a deleted auto link reappears on the next page load.

To bundle another edition, add its path to that list. The GitHub Pages workflow copies all of `parsed_data/` into the site. Any other edition JSON in the same layout can be loaded by hand at runtime.

## Using it

* One column per loaded edition, one chapter at a time.
* Hover near a block's left/right edge → anchor points (● block, ◇ gap above/below). Drag to another edition's block/gap to link.
* Click a link → relation, note, word diff. `Del` deletes. `Esc` cancels / deselects.
* Column header: ◀ ▶ reorder, ✕ remove. Press on a block's middle (hand cursor) and drag it down to stretch the chain above it; it can't go above its natural position.
* Links, names and shifts persist in `localStorage`; **Export/Import links** saves them as a file. Links are keyed by edition id (= file name without `.json`) + block id.
* **Demo variant** adds a perturbed copy of the first edition for trying things out.

Layout: `js/util.js` helpers · `diff.js` word diff · `store.js` state/links/persistence · `view.js` chains, anchors, drag · `panel.js` details panel · `main.js` toolbar/loading.
