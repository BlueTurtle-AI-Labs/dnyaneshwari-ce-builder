#!/usr/bin/env python3
"""Parse the Dandekar-edition Dnyaneshwari word index (Shabda/Ovi Suchi) PDF into
an ordered CSV of ovi_id, ovi_text.

Usage:
    python scripts/parse_shabda_suchi.py \
        raw_data/dandekar/Dnyaneshwari-Shabda-Ovi-Suchi-EBook-v1.0.pdf \
        -o parsed_data/dandekar/dandekar_ovis.csv

PDF layout (pages 32-4144, one table per page, 3 columns):
    "<n>. <word>" | ovi text | "||ज्ञाने.<adhyay>.<gita verse>.<ovi no>||"

A word index repeats every ovi once per indexed word, so the same ovi_id appears
many times. We keep one text per ovi_id (the most frequent decoding, which also
irons out the occasional glitchy rendering of a single row) and sort by
(adhyay, ovi number).

The PDF uses a legacy, non-Unicode font (SHREE-DEV-0709), so the extracted text
is gibberish like "&&kmZo.1.1&&"; shree_dev_decode.py converts it to Unicode.
The ovi_id column happens to be plain ASCII digits in that font and is read as is.

ovi_id format: "<adhyay>.<gita verse>.<ovi>" ("<adhyay>.<ovi>" in the places where the
source has no gita verse, e.g. chapter 1), "5.24-25.138" for a verse range, and a
suffix such as "15.16.508-A" is kept as printed.

Requires: pymupdf (pip install pymupdf)
"""
import argparse
import collections
import csv
import re
import sys
from multiprocessing import Pool
from pathlib import Path

import fitz  # PyMuPDF

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shree_dev_decode import decode  # noqa: E402

FIRST_PAGE, LAST_PAGE = 32, 4144   # 1-based, inclusive
ID_RE = re.compile(r"kmZo\.(\d+(?:\.\d+)*(?:-\d+)?(?:\.\d+)?(?:-[A-Za-z])?)")  # "kmZo" = ज्ञाने in the legacy font
PRIVATE_USE = re.compile("[-\U00010000-\U0010ffff]")


def extract_rows(args):
    """Return [(page, word_cell, text_cell, id_cell), ...] for a range of 0-based page indexes."""
    pdf_path, start, stop = args
    doc = fitz.open(pdf_path)
    rows = []
    for pn in range(start, stop):
        for table in doc[pn].find_tables().tables:
            for r in table.extract():
                if len(r) == 3:
                    rows.append((pn + 1, r[0] or "", r[1] or "", r[2] or ""))
    return rows


def parse_id(cell):
    """'&&kmZo.8.13.117&&' -> ('8.13.117', (8, 117, '')); None if it is not an ovi id."""
    m = ID_RE.search(cell.replace(" ", ""))
    if not m:
        return None
    ovi_id = m.group(1)
    parts = ovi_id.split(".")
    adhyay = int(parts[0])
    last = re.match(r"(\d+)(.*)", parts[-1])
    suffix = last.group(2) if last else ""
    # for "5.24-25.138" the ovi number is the last dotted part; for "12.5" it is the 2nd
    ovi_no = int(last.group(1))
    return ovi_id, (adhyay, ovi_no, suffix)


def clean_text(s):
    s = decode(s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\s*।\s*", " । ", s).strip(" ।")
    return s.strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", type=Path)
    ap.add_argument("-o", "--output", type=Path, default=Path("parsed_data/dandekar/dandekar_ovis.csv"))
    ap.add_argument("--first-page", type=int, default=FIRST_PAGE, help="1-based (default %(default)s)")
    ap.add_argument("--last-page", type=int, default=LAST_PAGE, help="1-based, inclusive (default %(default)s)")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--bom", action="store_true", help="write UTF-8 with BOM (helps Excel show Devanagari)")
    args = ap.parse_args()

    step = 100
    jobs = [(str(args.pdf), s, min(s + step, args.last_page))
            for s in range(args.first_page - 1, args.last_page, step)]
    with Pool(args.workers) as pool:
        raw_rows = [r for chunk in pool.map(extract_rows, jobs) for r in chunk]
    print(f"{len(raw_rows)} table rows from {args.last_page - args.first_page + 1} pages")

    variants = collections.defaultdict(collections.Counter)   # ovi_id -> {text: count}
    sortkey = {}
    skipped = []
    for page, _word, text, id_cell in raw_rows:
        parsed = parse_id(id_cell)
        if not parsed:
            skipped.append((page, id_cell))
            continue
        ovi_id, key = parsed
        variants[ovi_id][clean_text(text)] += 1
        sortkey[ovi_id] = key

    args.output.parent.mkdir(parents=True, exist_ok=True)
    disagreements, undecoded = [], []
    with open(args.output, "w", encoding="utf-8-sig" if args.bom else "utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ovi_id", "ovi_text"])
        for ovi_id in sorted(variants, key=lambda k: sortkey[k]):
            counts = variants[ovi_id]
            text = counts.most_common(1)[0][0]
            if len(counts) > 1:
                disagreements.append((ovi_id, counts))
            if PRIVATE_USE.search(text):
                undecoded.append(ovi_id)
            w.writerow([ovi_id, text])

    report = args.output.with_suffix(".report.txt")
    with open(report, "w", encoding="utf-8") as f:
        f.write(f"rows: {len(raw_rows)}\nunique ovi_ids: {len(variants)}\n")
        f.write(f"rows without a parsable ovi_id: {len(skipped)}\n")
        for page, cell in skipped:
            f.write(f"  page {page}: {cell!r}\n")
        f.write(f"ovi_ids whose rows decode differently: {len(disagreements)} (majority wins)\n")
        f.write(f"ovi_ids with an unmapped glyph in the winning text: {len(undecoded)}\n")
        for k in undecoded:
            f.write(f"  {k}\n")
        f.write("\n--- disagreements ---\n")
        for ovi_id, counts in disagreements:
            f.write(f"{ovi_id}\n")
            for t, n in counts.most_common():
                f.write(f"  {n:>4}  {t}\n")
    print(f"{len(variants)} unique ovis -> {args.output}")
    print(f"report -> {report}")


if __name__ == "__main__":
    main()
