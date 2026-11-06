#!/usr/bin/env python3
"""Automatically link the blocks of two editions and write a frontend link-map file.

Usage:
    python scripts/align_editions.py parsed_data/sansdocs/dnyaneshwari_sansdocs.json \
        parsed_data/dandekar/dnyaneshwari_dandekar.json \
        -o parsed_data/links/sansdocs_dandekar_links.json

Per chapter:
  * bg-verse and chapter-end blocks are linked in order (they are the same text in both).
  * dn-verse blocks (ovis) are aligned with a banded Needleman-Wunsch on text similarity
    (character-bigram Dice). Where the two chapters have the same number of ovis and every pair
    is similar this is simply 1:1; elsewhere the alignment skips the odd ovi and carries on with
    an offset. Ovis left without a partner are listed in the report.
Link relation: equivalent (text identical after removing punctuation/number), variant
(similar, wording differs), uncertain (weak match).
The output is in the frontend's "Export links" format (loaded automatically on startup).
"""
import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

BAND = 80
GAP = -0.35
MIN_SIM = 0.30        # a matched pair below this is not linked at all
UNCERTAIN_BELOW = 0.60


def norm(t):
    t = re.sub(r"\|\|[०-९0-9]+\|\|", "", t)
    return re.sub(r"[^ऀ-ॿ]|[|।॥०-९]", "", t)


def grams(t):
    n = norm(t)
    return Counter(n[i:i + 2] for i in range(len(n) - 1))


def dice(a, b):
    if not a or not b:
        return 0.0
    inter = sum((a & b).values())
    return 2 * inter / (sum(a.values()) + sum(b.values()))


def align(A, B):
    """A, B: lists of text. Returns [(i, j, sim)] for matched pairs."""
    ga, gb = [grams(x) for x in A], [grams(x) for x in B]
    n, m = len(A), len(B)
    NEG = -1e9
    sc = {}
    def S(i, j):
        k = (i, j)
        if k not in sc:
            sc[k] = dice(ga[i], gb[j])
        return sc[k]
    # DP over (i, j) with |(i - j) - shift| <= BAND, where shift handles length difference
    H = {}
    H[(0, 0)] = 0.0
    back = {}
    for i in range(n + 1):
        lo = max(0, i - BAND); hi = min(m, i + BAND + max(0, m - n))
        for j in range(lo, hi + 1):
            if i == 0 and j == 0:
                continue
            best, bk = NEG, None
            if i and j and (i - 1, j - 1) in H:
                v = H[(i - 1, j - 1)] + (2 * S(i - 1, j - 1) - 1 if S(i - 1, j - 1) >= MIN_SIM else -1.5)
                best, bk = v, 'd'
            if i and (i - 1, j) in H and H[(i - 1, j)] + GAP > best:
                best, bk = H[(i - 1, j)] + GAP, 'u'
            if j and (i, j - 1) in H and H[(i, j - 1)] + GAP > best:
                best, bk = H[(i, j - 1)] + GAP, 'l'
            if bk:
                H[(i, j)] = best; back[(i, j)] = bk
    i, j = n, m
    pairs = []
    while (i, j) != (0, 0):
        bk = back[(i, j)]
        if bk == 'd':
            s = S(i - 1, j - 1)
            if s >= MIN_SIM:
                pairs.append((i - 1, j - 1, s))
            i, j = i - 1, j - 1
        elif bk == 'u':
            i -= 1
        else:
            j -= 1
    return pairs[::-1]


def anchor(ed, ch, ref, side):
    return {"ed": ed, "ch": ch, "kind": "block", "ref": ref, "side": side}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("edition_a", type=Path)
    ap.add_argument("edition_b", type=Path)
    ap.add_argument("-o", "--output", type=Path, default=Path("parsed_data/links/sansdocs_dandekar_links.json"))
    args = ap.parse_args()

    ea, eb = (json.loads(p.read_text(encoding="utf-8")) for p in (args.edition_a, args.edition_b))
    ida, idb = args.edition_a.stem, args.edition_b.stem     # = the frontend's edition ids
    na = ea.get("edition_name") or ida
    links, report = [], []
    stats = Counter()

    cb = {c["chapter_number"]: c for c in eb["chapters"]}
    for ca in ea["chapters"]:
        ch = ca["chapter_number"]
        if ch not in cb:
            continue
        def add(x, y, rel, sim=None):
            links.append({"id": f"auto-{ch:02d}-{x['block_id']}-{y['block_id']}",
                          "a": anchor(ida, ch, x["block_id"], "R"), "b": anchor(idb, ch, y["block_id"], "L"),
                          "rel": rel, "note": "" if sim is None else f"auto-aligned, text similarity {sim:.2f}",
                          "created": "auto"})
            stats[rel] += 1

        # Gita verses & chapter-end: in order
        for kind in ("bg-verse", "chapter-end"):
            xs = [b for b in ca["blocks"] if b["block_type"] == kind]
            ys = [b for b in cb[ch]["blocks"] if b["block_type"] == kind]
            if len(xs) != len(ys):
                report.append(f"ch{ch}: {len(xs)} {kind} vs {len(ys)} - linked in order up to the shorter")
            for x, y in zip(xs, ys):
                add(x, y, "equivalent")

        xs = [b for b in ca["blocks"] if b["block_type"] == "dn-verse"]
        ys = [b for b in cb[ch]["blocks"] if b["block_type"] == "dn-verse"]
        pairs = align([b["block_text"] for b in xs], [b["block_text"] for b in ys])
        used_a = {i for i, _, _ in pairs}; used_b = {j for _, j, _ in pairs}
        for i, j, s in pairs:
            same = norm(xs[i]["block_text"]) == norm(ys[j]["block_text"])
            add(xs[i], ys[j], "equivalent" if same else ("variant" if s >= UNCERTAIN_BELOW else "uncertain"), None if same else s)
        # offsets: where does i - j change?
        offs, prev = [], None
        for i, j, _ in pairs:
            if (i - j) != prev:
                offs.append((i + 1, j + 1, j - i)); prev = i - j
        ua = [xs[i]["block_id"] for i in range(len(xs)) if i not in used_a]
        ub = [ys[j].get("ovi_id", ys[j]["block_id"]) for j in range(len(ys)) if j not in used_b]
        report.append(f"ch{ch}: {len(xs)} vs {len(ys)} ovis, {len(pairs)} linked; offset changes (ovi#a, ovi#b, b-a): {offs[1:] if len(offs) > 1 else 'none'}"
                      + (f"; unmatched in a: {ua}" if ua else "") + (f"; unmatched in b: {ub}" if ub else ""))

    out = {"format": "dnyaneshwari-link-map", "version": 1, "exported": "auto-generated by scripts/align_editions.py",
           "editions": [{"id": ida, "name": ida}, {"id": idb, "name": idb}], "links": links}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    rep = args.output.with_suffix(".report.txt")
    rep.write_text(f"{len(links)} links {dict(stats)}\n" + "\n".join(report) + "\n", encoding="utf-8")
    print(f"{len(links)} links {dict(stats)} -> {args.output}\nreport -> {rep}")


if __name__ == "__main__":
    main()
