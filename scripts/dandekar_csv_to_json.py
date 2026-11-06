#!/usr/bin/env python3
"""Convert the Dandekar ovi CSV (ovi_id, ovi_text) into the same JSON layout as
parsed_data/sansdocs/dnyaneshwari_sansdocs.json, so validate_json.py can run on it.

Usage:
    python scripts/dandekar_csv_to_json.py parsed_data/dandekar/dandekar_ovis.csv \
        -o parsed_data/dandekar/dnyaneshwari_dandekar.json \
        --from-edition parsed_data/sansdocs/dnyaneshwari_sansdocs.json

The index PDF only contains ovis, so everything that is not an ovi is copied from the
sansdocs JSON (the Gita verses and chapter-end line do not vary between editions):
  * chapter titles, "bg-verse" blocks and the "chapter-end" block
  * each Gita block is placed before the first ovi whose gita-verse number (the middle
    part of ovi_id) reaches it; ovis before the first Gita verse (ids like "1.5") come first
  * NOT copied: chapter 18 epilogue blocks and stray headings

Differences from the sansdocs JSON:
  * each block also carries "ovi_id" (the Dandekar id, e.g. "8.13.117")
  * block_text is "seg| seg| seg| seg ||<ovi number in Devanagari>||", the number being
    the last part of ovi_id (so "15.16.508-A" is numbered 508 again - a real duplicate)
"""
import argparse
import csv
import json
import re
from pathlib import Path

DEV = "०१२३४५६७८९"
TRANS = {ord(c): str(i) for i, c in enumerate(DEV)}


def dev(n: int) -> str:
    return "".join(DEV[int(c)] for c in str(n))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv_file", type=Path)
    ap.add_argument("-o", "--output", type=Path, default=Path("parsed_data/dandekar/dnyaneshwari_dandekar.json"))
    ap.add_argument("--from-edition", type=Path, required=True,
                    help="sansdocs-style JSON to copy chapter titles, Gita verses and chapter-end from")
    args = ap.parse_args()

    titles, gita, ends = {}, {}, {}
    for c in json.loads(args.from_edition.read_text(encoding="utf-8"))["chapters"]:
        n = c["chapter_number"]
        titles[n] = c["chapter_title"]
        gita[n] = [(int(re.search(r"[०-९]+", b["block_text"]).group().translate(TRANS)), b)
                   for b in c["blocks"] if b["block_type"] == "bg-verse"]
        ends[n] = [b for b in c["blocks"] if b["block_type"] == "chapter-end"]

    chapters = {}
    with open(args.csv_file, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            ovi_id, text = row["ovi_id"], row["ovi_text"]
            ch = int(ovi_id.split(".")[0])
            ovi_no = int(re.match(r"\d+", ovi_id.split(".")[-1]).group())
            body = re.sub(r"\s*।\s*", "| ", text).strip().rstrip("|").strip()
            parts = ovi_id.split(".")
            gita_end = int(parts[1].split("-")[-1]) if len(parts) == 3 else 0   # 0: before the first Gita verse
            chapters.setdefault(ch, []).append((ovi_id, gita_end, f"{body} ||{dev(ovi_no)}||"))

    out_chapters = []
    for ch in sorted(chapters):
        seq = []   # (block_type, ovi_id or None, text)
        pending = list(gita[ch])
        for ovi_id, gita_end, text in chapters[ch]:
            while pending and pending[0][0] <= gita_end:
                b = pending.pop(0)[1]
                seq.append(("bg-verse", None, b["block_text"]))
            seq.append(("dn-verse", ovi_id, text))
        for _, b in pending:   # Gita verses after the last ovi that mentions one
            print(f"chapter {ch}: Gita block after the last ovi: {b['block_text'][:40]}")
            seq.append(("bg-verse", None, b["block_text"]))
        for b in ends[ch]:
            seq.append(("chapter-end", None, b["block_text"]))
        blocks = []
        for i, (kind, ovi_id, text) in enumerate(seq, start=1):
            blk = {"block_id": f"{ch:02d}-{i:04d}", "block_type": kind}
            if ovi_id:
                blk["ovi_id"] = ovi_id
            blk["block_text"] = text
            blocks.append(blk)
        n_dn = sum(b["block_type"] == "dn-verse" for b in blocks)
        out_chapters.append({"chapter_number": ch, "chapter_title": titles.get(ch, ""),
                             "total_num_blocks": len(blocks), "total_dn_verses": n_dn,
                             "blocks": blocks})

    total = sum(c["total_num_blocks"] for c in out_chapters)
    total_dn = sum(c["total_dn_verses"] for c in out_chapters)
    data = {"book_name": "Dnyaneshwari",
            "edition": "Dandekar edition, parsed from the Shabda-Ovi Suchi (word index) PDF",
            "num_chapters": len(out_chapters),
            "total_num_blocks": total,
            "total_dn_verses": total_dn,
            "chapters": out_chapters}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")
    print(f"{total} blocks ({total_dn} ovis) in {len(out_chapters)} chapters -> {args.output}")


if __name__ == "__main__":
    main()
