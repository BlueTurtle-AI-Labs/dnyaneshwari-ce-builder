# Dnyaneshwari Critical Edition Builder

**[Open the web app →](https://blueturtle-ai-labs.github.io/dnyaneshwari-ce-builder/frontend/)**

Tools for building a critical edition of the Dnyaneshwari: digitise several editions into one common JSON layout, validate them, then compare them side by side and link corresponding verses (ovis) in a browser.

## Repository layout

| Path | What |
|---|---|
| `frontend/` | The static comparison/linking web app (see [frontend/README.md](frontend/README.md)). |
| `parsed_data/sansdocs/` | Sansdocs edition as JSON, plus its validation report. |
| `parsed_data/dandekar/` | Dandekar edition: `dandekar_ovis.csv` (ordered `ovi_id,ovi_text`), `dnyaneshwari_dandekar.json`, parse and validation reports. |
| `raw_data/` | Source material: edition 1 text files; the Dandekar word-index PDF. |
| `scripts/` | Conversion and validation scripts (below). |
| `.github/workflows/pages.yml` | Deploys `frontend/` and `parsed_data/` to GitHub Pages on every push to `main`. |

## JSON layout

```
{ book_name, edition, num_chapters, total_num_blocks, total_dn_verses,
  chapters: [ { chapter_number, chapter_title, total_num_blocks, total_dn_verses,
                blocks: [ { block_id: "CC-NNNN", block_type, block_text } ] } ] }
```

`block_type` is one of `dn-verse` (an ovi, text `seg| seg| seg| seg ||<number>||`), `bg-verse` (Bhagavad Gita verse), `heading`, `chapter-end`, `epilogue-verse`, `epilogue-note`. Dandekar ovi blocks additionally carry `ovi_id` (`<adhyay>.<gita verse>.<ovi no>`).

## Scripts

```
python scripts/txt_to_json.py raw_data/edition1-sansdocs -o parsed_data/sansdocs/dnyaneshwari_sansdocs.json
python scripts/validate_json.py parsed_data/sansdocs/dnyaneshwari_sansdocs.json
```

**Dandekar edition** (source: the Dandekar *Shabda-Ovi Suchi* word-index PDF, pages 32–4144; requires `pip install pymupdf`):

```
# 1. PDF -> ordered, de-duplicated CSV (decodes the legacy SHREE-DEV-0709 font)
python -X utf8 scripts/parse_shabda_suchi.py raw_data/dandekar/Dnyaneshwari-Shabda-Ovi-Suchi-EBook-v1.0.pdf \
    -o parsed_data/dandekar/dandekar_ovis.csv
# 2. CSV -> JSON; Gita verses, chapter titles and chapter-end lines are copied from the sansdocs edition
python -X utf8 scripts/dandekar_csv_to_json.py parsed_data/dandekar/dandekar_ovis.csv \
    --from-edition parsed_data/sansdocs/dnyaneshwari_sansdocs.json
# 3. validate
python -X utf8 scripts/validate_json.py parsed_data/dandekar/dnyaneshwari_dandekar.json
```

**Linking two editions** — `python -X utf8 scripts/align_editions.py <editionA.json> <editionB.json> -o parsed_data/links/sansdocs_dandekar_links.json` aligns the ovis per chapter by text similarity (1:1 where the chapters agree, skipping the odd ovi and continuing with an offset elsewhere) and writes a link map the frontend loads automatically. A `.report.txt` beside it lists the offset changes and unmatched ovis per chapter.

`shree_dev_decode.py` is the glyph→Unicode decoder used by step 1.

### Known issues in the Dandekar JSON

* Ovi 18.78.1689 is absent from the index, so it is missing (validator `DN_NUM_GAP`).
* `15.16.508-A` is a genuine second ovi numbered 508 (`DN_NUM_BACKWARDS`).
* Three ovis (`5.1.7`, `18.15.370`, `18.48.946`) contain one glyph that could not be decoded (`STRAY_CHARS`).
* Chapter 18 epilogue blocks are not included (`NO_EPILOGUE` warning).

## Running locally

```
python -m http.server 8000     # from the repo root
# open http://localhost:8000/frontend/
```
