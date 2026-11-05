#!/usr/bin/env python3
"""Validate the converted Dnyaneshwari JSON and write a human-readable report.

Usage:
    python scripts/validate_json.py dnyaneshwari_edition1.json \
        --raw-dir raw_data/edition1-sansdocs
Writes <json name>_val_report.txt next to the JSON (override with -o).

--raw-dir is optional; when given, each issue is annotated with the line number
in the raw adhyayNN.txt file so you can jump straight to it.

Severity:
    ERROR   - almost certainly a defect in the raw file or the conversion
    WARNING - suspicious, worth a look
    INFO    - structural oddity that may be legitimate (e.g. ovi without 4 parts)
"""

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

DEV_DIGITS = "०१२३४५६७८९"
TRANS = {ord(c): str(i) for i, c in enumerate(DEV_DIGITS)}
NUM = r"[०-९]+"

VERSE_END_RE = re.compile(rf"\|\|\s*({NUM})\s*\|\|\s*$")          # clean "||१२||" at end
ANY_MARKER_RE = re.compile(rf"\|\|\s*({NUM})\s*\|\|")            # clean marker anywhere
LOOSE_MARKER_RE = re.compile(r"\|\|\s*\S{0,4}\s*[०-९]+\s*\S{0,3}$")  # typo'd marker at end
COLOPHON_RE = re.compile(rf"({NUM})\s*अ\s*\|\|\s*$")

VALID_TYPES = {"dn-verse", "bg-verse", "heading", "chapter-end", "epilogue-verse", "epilogue-note"}
# Bhagavad Gita verse counts per chapter (ch13 is 34 or 35 depending on the recension)
BG_COUNTS = {1: {47}, 2: {72}, 3: {43}, 4: {42}, 5: {29}, 6: {47}, 7: {30}, 8: {28}, 9: {34},
             10: {42}, 11: {55}, 12: {20}, 13: {34, 35}, 14: {27}, 15: {20}, 16: {24},
             17: {28}, 18: {78}}

# chars allowed in verse text besides Devanagari letters
ALLOWED_PUNCT = set(" |?-!‘’“”'\"(),;:.…")


def n(dev: str) -> int:
    return int(dev.translate(TRANS))


class Report:
    def __init__(self, raw_dir):
        self.items = []  # (chapter, order, severity, code, block_id, message, text)
        self.raw_lines = {}
        if raw_dir:
            for p in Path(raw_dir).glob("adhyay*.txt"):
                m = re.search(r"(\d+)", p.stem)
                if m:
                    self.raw_lines[int(m.group(1))] = p.read_text(encoding="utf-8-sig").splitlines()

    def locate(self, ch, text):
        lines = self.raw_lines.get(ch)
        if not lines or not text:
            return None
        # use a distinctive chunk: first 25 chars of the first segment
        key = re.sub(r"\s+", " ", text).strip()[:25]
        hits = [i + 1 for i, l in enumerate(lines) if key in re.sub(r"\s+", " ", l)]
        if len(hits) == 1:
            return str(hits[0])
        if hits:
            return "/".join(map(str, hits[:3])) + "?"
        return None

    def add(self, ch, order, sev, code, block_id, msg, text=""):
        self.items.append((ch, order, sev, code, block_id, msg, text))


def validate(data, rep: Report):
    chapters = data.get("chapters", [])

    # ---------- top-level
    if data.get("num_chapters") != len(chapters):
        rep.add(0, 0, "ERROR", "TOP_COUNT", "-", f"num_chapters={data.get('num_chapters')} but {len(chapters)} chapters present")
    blocks_total = sum(len(c.get("blocks", [])) for c in chapters)
    if data.get("total_num_blocks") != blocks_total:
        rep.add(0, 0, "ERROR", "TOP_COUNT", "-", f"total_num_blocks={data.get('total_num_blocks')} but {blocks_total} blocks present")
    dn_total = sum(b.get("block_type") == "dn-verse" for c in chapters for b in c.get("blocks", []))
    if data.get("total_dn_verses") != dn_total:
        rep.add(0, 0, "ERROR", "TOP_COUNT", "-", f"total_dn_verses={data.get('total_dn_verses')} but {dn_total} dn-verse blocks present")
    nums = [c.get("chapter_number") for c in chapters]
    if nums != list(range(1, len(chapters) + 1)):
        rep.add(0, 0, "ERROR", "CHAPTER_ORDER", "-", f"chapter numbers not 1..N in order: {nums}")
    if len(chapters) != 18:
        rep.add(0, 0, "WARNING", "CHAPTER_COUNT", "-", f"expected 18 chapters, found {len(chapters)}")

    for c in chapters:
        ch = c["chapter_number"]
        blocks = c.get("blocks", [])
        if not c.get("chapter_title"):
            rep.add(ch, 0, "ERROR", "TITLE", "-", "empty chapter_title")
        width = 4
        n_dn = sum(b.get("block_type") == "dn-verse" for b in blocks)
        if c.get("total_num_blocks") != len(blocks):
            rep.add(ch, 0, "ERROR", "CH_COUNT", "-", f"chapter total_num_blocks={c.get('total_num_blocks')} but {len(blocks)} blocks present")
        if c.get("total_dn_verses") != n_dn:
            rep.add(ch, 0, "ERROR", "CH_COUNT", "-", f"chapter total_dn_verses={c.get('total_dn_verses')} but {n_dn} dn-verse blocks present")

        # ---------- per-block generic checks
        for i, b in enumerate(blocks, start=1):
            bid, t, text = b.get("block_id", ""), b.get("block_type"), b.get("block_text", "")
            if bid != f"{ch:02d}-{i:0{width}d}":
                rep.add(ch, i, "ERROR", "BLOCK_ID", bid, f"block_id should be {ch:02d}-{i:0{width}d}", text)
            if t not in VALID_TYPES:
                rep.add(ch, i, "ERROR", "BLOCK_TYPE", bid, f"unknown block_type {t!r}", text)
            if not text.strip():
                rep.add(ch, i, "ERROR", "EMPTY", bid, "empty block_text")
                continue
            if text != text.strip() or "  " in text:
                rep.add(ch, i, "WARNING", "WHITESPACE", bid, "leading/trailing/double whitespace", text)
            bad = sorted({ch_ for ch_ in text
                          if not ("ऀ" <= ch_ <= "ॿ" or ch_ in "‌‍" or ch_ in ALLOWED_PUNCT)})
            if bad:
                rep.add(ch, i, "ERROR", "STRAY_CHARS", bid, "unexpected characters " + " ".join(f"{x!r}(U+{ord(x):04X})" for x in bad), text)
            if re.search(r"\.\s*[०-९]|[०-९]+\s*/\||/\|", text) or "." in text.replace("...", ""):
                rep.add(ch, i, "WARNING", "PUNCT", bid, "stray '.' or '/' (likely marker typo)", text)
            if re.search(r"[0-9]", text):
                rep.add(ch, i, "ERROR", "ASCII_DIGIT", bid, "ASCII digit in text", text)
            if re.search(r"(?<!\|)\|(?!\|)\s*\|(?!\|)", text):
                rep.add(ch, i, "WARNING", "EMPTY_SEGMENT", bid, "empty segment between pipes ('| |')", text)

        # ---------- dn-verse checks
        dn = [(i, b) for i, b in enumerate(blocks, start=1) if b.get("block_type") == "dn-verse"]
        parsed = []  # (i, bid, num|None)
        for i, b in dn:
            text, bid = b["block_text"], b["block_id"]
            m = VERSE_END_RE.search(text)
            markers = ANY_MARKER_RE.findall(text)
            if not m:
                if LOOSE_MARKER_RE.search(text):
                    rep.add(ch, i, "ERROR", "DN_MARKER_TYPO", bid, "verse-end marker malformed (not '||N||')", text)
                else:
                    rep.add(ch, i, "ERROR", "DN_NO_MARKER", bid, "no verse-end marker '||N||'", text)
                parsed.append((i, bid, None))
                continue
            if len(markers) > 1:
                rep.add(ch, i, "ERROR", "DN_MULTI", bid,
                        f"{len(markers)} verse markers in one block ({', '.join(markers)}): lines merged or newline missing", text)
            body = text[:m.start()]
            inner = body.count("|")
            if inner != 3:
                rep.add(ch, i, "INFO", "DN_PARTS", bid, f"{inner + 1} segments (ovi usually has 4)", text)
            parsed.append((i, bid, n(m.group(1))))

        # numbering: report an isolated outlier once, a real jump once
        seq = [p for p in parsed if p[2] is not None]
        prev = 0
        for k, (i, bid, num) in enumerate(seq):
            if num == prev + 1:
                prev = num
                continue
            nxt = seq[k + 1][2] if k + 1 < len(seq) else None
            text = blocks[i - 1]["block_text"]
            if nxt == prev + 2:      # this one is the odd one out
                kind = "DUPLICATE" if num == prev else "TYPO"
                rep.add(ch, i, "ERROR", f"DN_NUM_{kind}", bid, f"verse number {num}, expected {prev + 1} (neighbours are consistent -> typo)", text)
                prev += 1
            elif num <= prev:
                rep.add(ch, i, "ERROR", "DN_NUM_BACKWARDS", bid, f"verse number {num} after {prev}", text)
                prev = num
            else:
                rep.add(ch, i, "ERROR", "DN_NUM_GAP", bid, f"verse number jumps {prev} -> {num} (missing {num - prev - 1})", text)
                prev = num
        if seq:
            rep.add(ch, 10**6, "INFO", "DN_TOTAL", "-", f"last ovi number {seq[-1][2]}, dn-verse blocks {len(dn)}")

        # ---------- bg-verse checks
        bg_nums = []
        bg_seen_colophon = False
        for i, b in enumerate(blocks, start=1):
            if b.get("block_type") != "bg-verse":
                continue
            text, bid = b["block_text"], b["block_id"]
            ms = [n(x) for x in ANY_MARKER_RE.findall(text)]
            if not ms and not COLOPHON_RE.search(text):
                rep.add(ch, i, "ERROR", "BG_NO_MARKER", bid, "no '||N||' marker in Gita block", text)
            bg_nums += [(x, i, bid, text) for x in ms]
            if COLOPHON_RE.search(text):
                bg_seen_colophon = True
                if i != max(j for j, bb in enumerate(blocks, 1) if bb.get("block_type") == "bg-verse"):
                    rep.add(ch, i, "ERROR", "BG_COLOPHON_POS", bid, "chapter colophon is not in the last Gita block", text)
        if not bg_seen_colophon:
            rep.add(ch, 10**6, "ERROR", "BG_NO_COLOPHON", "-", "Gita colophon '||Nअ ||' not found")
        prev = 0
        for k, (x, i, bid, text) in enumerate(bg_nums):
            if x == prev + 1:
                prev = x
                continue
            nxt = bg_nums[k + 1][0] if k + 1 < len(bg_nums) else None
            if nxt == prev + 2:
                rep.add(ch, i, "ERROR", "BG_NUM_TYPO", bid, f"Gita verse number {x}, expected {prev + 1}", text)
                prev += 1
            else:
                rep.add(ch, i, "ERROR", "BG_NUM_JUMP", bid, f"Gita verse number jumps {prev} -> {x}", text)
                prev = x
        total_bg = len(bg_nums)
        if total_bg not in BG_COUNTS.get(ch, {total_bg}):
            rep.add(ch, 10**6, "ERROR", "BG_COUNT", "-",
                    f"{total_bg} Gita verse markers found, expected {sorted(BG_COUNTS[ch])} (missing/extra verse or lost marker)")

        # ---------- structure checks
        types = [b.get("block_type") for b in blocks]
        if types.count("chapter-end") != 1:
            rep.add(ch, 10**6, "ERROR", "CHAPTER_END", "-", f"{types.count('chapter-end')} chapter-end blocks (expected 1)")
        else:
            idx = types.index("chapter-end")
            tail = set(types[idx + 1:])
            if ch != 18 and tail:
                rep.add(ch, idx + 1, "ERROR", "AFTER_END", blocks[idx]["block_id"], "blocks present after chapter-end")
            if ch == 18 and not tail:
                rep.add(ch, idx + 1, "WARNING", "NO_EPILOGUE", blocks[idx]["block_id"], "chapter 18 has no epilogue blocks")
        if types and types[0] != "dn-verse":
            rep.add(ch, 1, "INFO", "FIRST_BLOCK", blocks[0]["block_id"], f"chapter starts with {types[0]}, expected dn-verse")
        # two consecutive bg-verse blocks usually mean a blank line inside a Gita verse group / lost newline
        for i in range(1, len(blocks)):
            if types[i] == types[i - 1] == "bg-verse":
                rep.add(ch, i + 1, "INFO", "BG_ADJACENT", blocks[i]["block_id"],
                        "two Gita blocks in a row (no commentary between)", blocks[i]["block_text"])
        for i, b in enumerate(blocks, start=1):
            if b.get("block_type") == "heading":
                rep.add(ch, i, "WARNING", "HEADING", b["block_id"], "stray heading in source (not a verse)", b["block_text"])


def render(data, rep: Report, json_name):
    sev_rank = {"ERROR": 0, "WARNING": 1, "INFO": 2}
    out = []
    out.append(f"VALIDATION REPORT for {json_name}")
    out.append("=" * 78)
    counts = Counter(i[2] for i in rep.items)
    out.append(f"Chapters: {len(data.get('chapters', []))}   Blocks: {data.get('total_num_blocks')}   dn-verses: {data.get('total_dn_verses')}")
    out.append(f"Issues:   {counts['ERROR']} ERROR   {counts['WARNING']} WARNING   {counts['INFO']} INFO")
    by_code = Counter((i[2], i[3]) for i in rep.items)
    out.append("\nBy type:")
    for (sev, code), k in sorted(by_code.items(), key=lambda x: (sev_rank[x[0][0]], x[0][1])):
        out.append(f"  {sev:<8}{code:<20}{k}")
    per_ch = Counter(i[0] for i in rep.items if i[2] != "INFO")
    out.append("\nErrors+warnings per chapter: " + (", ".join(f"ch{c:02d}:{k}" for c, k in sorted(per_ch.items())) or "none"))

    grouped = defaultdict(list)
    for it in rep.items:
        grouped[it[0]].append(it)
    for ch in sorted(grouped):
        out.append("\n" + "=" * 78)
        out.append("GLOBAL" if ch == 0 else f"CHAPTER {ch}   (raw file: adhyay{ch:02d}.txt)")
        out.append("=" * 78)
        for ch_, order, sev, code, bid, msg, text in sorted(grouped[ch], key=lambda x: (x[1], sev_rank[x[2]])):
            line = rep.locate(ch_, text)
            loc = f"  [line {line}]" if line else ""
            out.append(f"[{sev}] {code}  block {bid}{loc}")
            out.append(f"    {msg}")
            if text:
                out.append(f"    > {text if len(text) <= 220 else text[:217] + '...'}")
    if not rep.items:
        out.append("\nNo issues found.")
    return "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("json_file", type=Path)
    ap.add_argument("--raw-dir", type=Path, help="folder with adhyayNN.txt, to show raw line numbers")
    ap.add_argument("-o", "--output", type=Path, help="report path (default: <json stem>_val_report.txt)")
    args = ap.parse_args()

    data = json.loads(args.json_file.read_text(encoding="utf-8"))
    rep = Report(args.raw_dir)
    validate(data, rep)
    out_path = args.output or args.json_file.with_name(args.json_file.stem + "_val_report.txt")
    out_path.write_text(render(data, rep, args.json_file.name), encoding="utf-8")
    c = Counter(i[2] for i in rep.items)
    print(f"Wrote {out_path}: {c['ERROR']} errors, {c['WARNING']} warnings, {c['INFO']} info")


if __name__ == "__main__":
    main()
