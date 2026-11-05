# Critical Edition Builder (frontend)

Static site — no build step.

```
# from the repo root, so the converted JSON is auto-loaded:
python -m http.server 8000
# then open http://localhost:8000/frontend/
```
Opening `frontend/index.html` directly also works; then use **+ Add edition** (or drag & drop) to load JSON files.

* One column per loaded edition JSON (output of `scripts/txt_to_json.py`), one chapter at a time.
* Hover near a block's left/right edge → anchor points (● block, ◇ gap above/below). Drag to another edition's block/gap to link.
* Click a link → relation, note, word diff. `Del` deletes. `Esc` cancels / deselects.
* Column header: ◀ ▶ reorder, ✕ remove. Press on a block's middle (hand cursor) and drag it down to stretch the chain above it; it can't go above its natural position.
* Links, names, shifts persist in `localStorage`; **Export/Import links** saves them as a file. Links are keyed by edition id (= file name) + block id.
* **Demo variant** adds a perturbed copy of the first edition for trying things out.

Layout: `js/util.js` helpers · `diff.js` word diff · `store.js` state/links/persistence · `view.js` chains, anchors, drag · `panel.js` details panel · `main.js` toolbar/loading.
