#!/usr/bin/env python3
"""Convert the raw Dnyaneshwari chapter txt files into a single JSON file.

Usage:
    python scripts/txt_to_json.py raw_data/edition1-sansdocs -o dnyaneshwari_sansdocs.json

Input files are expected to be named like adhyay01.txt ... adhyay18.txt.

Per-file layout:
    <title line>                      (ignored, e.g. "||ज्ञानेश्वरी भावार्थदीपिका अध्याय १ ||")
    <invocation line>                 (ignored)
    <chapter number as text line>     (ignored)
    <chapter name line>               -> chapter_title
    blocks...
        indented line(s)     -> "bg-verse"  (Bhagavad Gita verse(s), lines joined with a space)
        non-indented line    -> "dn-verse"  (one Dnyaneshwari ovi per line)
        short unnumbered non-indented line -> "heading" (stray section titles in the source)
    the chapter-end marker "इति श्री...ज्ञानदेवविरचितायां ..." -> "chapter-end"
    anything after the marker (only chapter 18) -> "epilogue-verse" (numbered verse lines)
                                                   or "epilogue-note" (other lines)

The Gita colophon ("... अर्जुनविषादयोगोनाम प्रथमोऽध्यायः ||१अ ||") closes the last
Gita verse of the chapter and is merged into that bg-verse block.

Block ids are "<chapter:02d>-<n:04d>", n being the 1-based position of the block in
the chapter (fixed 4-digit width, since chapter 18 has > 999 blocks).
"""

import argparse
import json
import re
import sys
from pathlib import Path

EDITION = "Dnyaneshwari Digital Edition, sourced from https://sanskritdocuments.org/"
BOOK_NAME = "Dnyaneshwari"
ID_WIDTH = 4

DEV_DIGITS = "०१२३४५६७८९"
TRANS = {ord(c): str(i) for i, c in enumerate(DEV_DIGITS)}

VERSE_NUM_RE = re.compile(r"\|\|\s*\.?\s*([०-९]+)\s*[|/]{1,2}\s*$")  # tolerant of source typos
BG_VERSE_NUM_RE = re.compile(r"\|\|\s*[०-९]+\s*\|\|")  # anywhere in the block
BG_COLOPHON_RE = re.compile(r"[०-९]+\s*अ\s*\|\|")  # ...||१अ ||
CHAPTER_END_RE = re.compile(r"^\s*इति\s+श्री\s*ज्ञानदेवविरचितायां")
FILE_RE = re.compile(r"adhyay(\d+)\.txt$", re.IGNORECASE)


def to_int(dev: str) -> int:
    return int(dev.translate(TRANS))


def clean(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip()


def parse_chapter(path: Path, chapter_number: int, warnings: list):
    raw = path.read_text(encoding="utf-8-sig")
    lines = raw.splitlines()

    # --- header: skip blank lines, then 4 lines (title, invocation, number, name)
    idx = 0
    header = []
    while idx < len(lines) and len(header) < 4:
        if lines[idx].strip():
            header.append(lines[idx])
        idx += 1
    if len(header) < 4:
        raise ValueError(f"{path.name}: header too short")
    chapter_title = clean(header[3]).rstrip("|").strip()

    blocks = []  # list of (type, text)
    bg_buf = []
    state = "body"  # body | epilogue
    saw_end = False

    def flush_bg():
        if not bg_buf:
            return
        text = clean(" ".join(bg_buf))
        bg_buf.clear()
        if blocks and blocks[-1][0] == "bg-verse" and BG_COLOPHON_RE.search(text):
            # chapter colophon: belongs to the last Gita verse
            blocks[-1] = ("bg-verse", blocks[-1][1] + " " + text)
        else:
            blocks.append(("bg-verse", text))

    prev_blank = True
    for line in lines[idx:]:
        last_was_dn = bool(blocks) and blocks[-1][0] == "dn-verse"
        if not line.strip():
            flush_bg()
            prev_blank = True
            continue

        if state == "body":
            if CHAPTER_END_RE.match(line):
                flush_bg()
                blocks.append(("chapter-end", clean(line)))
                saw_end = True
                state = "epilogue"
            elif line[0] in " \t":
                if last_was_dn and not bg_buf and not prev_blank:
                    # indented line glued to the previous ovi: its wrapped continuation
                    blocks[-1] = ("dn-verse", blocks[-1][1] + " " + clean(line))
                else:
                    bg_buf.append(line)
            else:
                flush_bg()
                text = clean(line)
                words = text.replace("|", " ").split()
                if not VERSE_NUM_RE.search(text) and len(words) <= 6:
                    # stray section heading in the source, e.g. "कुंडलीनी दर्शन. | | |"
                    blocks.append(("heading", " ".join(words)))
                else:
                    blocks.append(("dn-verse", text))
        else:  # epilogue (chapter 18 only)
            text = clean(line)
            kind = "epilogue-verse" if VERSE_NUM_RE.search(text) else "epilogue-note"
            blocks.append((kind, text))
        prev_blank = False
    flush_bg()

    if not saw_end:
        warnings.append(f"{path.name}: chapter-end marker not found")
    if chapter_number != 18 and any(t.startswith("epilogue") for t, _ in blocks):
        warnings.append(f"{path.name}: unexpected text after chapter-end marker")

    # --- sanity checks
    dn_expected = 1
    for t, text in blocks:
        if t == "dn-verse":
            m = VERSE_NUM_RE.search(text)
            if not m:
                warnings.append(f"{path.name}: dn-verse without number: {text[:50]}")
            elif to_int(m.group(1)) != dn_expected:
                warnings.append(
                    f"{path.name}: dn-verse numbered {to_int(m.group(1))}, expected {dn_expected}"
                )
                dn_expected = to_int(m.group(1))
            dn_expected += 1
        elif t == "bg-verse" and not BG_VERSE_NUM_RE.search(text):
            warnings.append(f"{path.name}: bg-verse without ending marker: {text[:50]}")
    if not any(t == "bg-verse" and BG_COLOPHON_RE.search(x) for t, x in blocks):
        warnings.append(f"{path.name}: Gita colophon (||Nअ ||) not found")

    width = ID_WIDTH
    return {
        "chapter_number": chapter_number,
        "chapter_title": chapter_title,
        "total_num_blocks": len(blocks),
        "total_dn_verses": sum(t == "dn-verse" for t, _ in blocks),
        "blocks": [
            {
                "block_id": f"{chapter_number:02d}-{n:0{width}d}",
                "block_type": t,
                "block_text": text,
            }
            for n, (t, text) in enumerate(blocks, start=1)
        ],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("data_dir", type=Path, help="folder containing adhyayNN.txt files")
    ap.add_argument("-o", "--output", type=Path, default=Path("dnyaneshwari_sansdocs.json"))
    args = ap.parse_args()

    files = []
    for p in args.data_dir.iterdir():
        m = FILE_RE.search(p.name)
        if m:
            files.append((int(m.group(1)), p))
    files.sort()
    if not files:
        sys.exit(f"No adhyayNN.txt files found in {args.data_dir}")

    warnings: list = []
    chapters = [parse_chapter(p, n, warnings) for n, p in files]

    all_blocks = [b for c in chapters for b in c["blocks"]]
    out = {
        "book_name": BOOK_NAME,
        "edition": EDITION,
        "num_chapters": len(chapters),
        "total_num_blocks": len(all_blocks),
        "total_dn_verses": sum(b["block_type"] == "dn-verse" for b in all_blocks),
        "chapters": chapters,
    }
    args.output.write_text(json.dumps(out, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")

    print(f"Wrote {args.output}: {out['num_chapters']} chapters, "
          f"{out['total_num_blocks']} blocks, {out['total_dn_verses']} dn-verses")
    for c in chapters:
        counts = {}
        for b in c["blocks"]:
            counts[b["block_type"]] = counts.get(b["block_type"], 0) + 1
        print(f"  ch{c['chapter_number']:02d} {c['chapter_title']!r}: {counts}")
    if warnings:
        print(f"\n{len(warnings)} warning(s):")
        for w in warnings:
            print("  -", w)


if __name__ == "__main__":
    main()
