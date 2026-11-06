"""Decoder for the legacy SHREE-DEV-0709 font encoding -> Unicode Devanagari.

Input strings are sequences of characters whose code points are the glyph codes
(as PyMuPDF reports them for the PDF's Type1 font glyph names).
"""
import re

D = '\u094d'  # halant
# kind: C full consonant, H half consonant (consonant + halant, glyph without stem),
#       L full conjunct glyph, J half conjunct glyph, V independent vowel,
#       M post-base matra/sign, P pre-base i-matra, R reph, K rakar (्र after consonant),
#       X literal text (punctuation, digits, ...)
T = {}
def add(kind, codes, val):
    for c in codes if isinstance(codes, (list, tuple)) else [codes]:
        T[c if isinstance(c, int) else ord(c)] = (kind, val)

for ch, v in dict(A='अ', B='इ', C='उ', D='ऊ', E='ए', F='ऋ').items(): add('V', ch, v)
cons = dict(H='क', I='ख', J='ग', K='घ', M='च', N='छ', O='ज', P='झ', Q='ट', R='ठ', S='ड', T='ढ',
            U='ण', V='त', W='थ', X='द', Y='ध', Z='न', **{chr(92): 'फ', '^': 'भ', '_': 'म', '`': 'य',
            'a': 'र', 'c': 'ल', 'd': 'व', 'e': 'श', 'f': 'ष', 'g': 'स', 'h': 'ह', 'i': 'ळ',
            'n': 'प', '~': 'ब', 'b': 'ब'})
for ch, v in cons.items(): add('C', ch, v)
add('L', 'j', 'क्ष'); add('L', 'k', 'ज्ञ'); add('L', 'l', 'श्र')
add('M', 'm', 'ा'); add('M', 'o', 'े'); add('M', 'r', 'ी'); add('M', 's', 'ी'); add('M', 't', 'ीं')
add('M', 'w', 'ु'); add('M', 'y', 'ू'); add('M', '|', 'ें'); add('M', 167, 'ं'); add('M', 168, 'ं')
add('P', '{', 'ि'); add('P', 'p', 'ि'); add('P', '[', 'ि'); add('P', 'q', 'िं'); add('Q', 'u', 'ि'); add('Q', 'v', 'ीं')
add('M', 178, D)
add('X', '&', '।'); add('X', ' ', ' ')
for i, c in enumerate('०१२३४५६७८९'): add('X', str(i), c)
add('X', '.', '.'); add('X', '-', '-')
add('L', 8250, 'ॐ')
add('H', 203, 'त'+D)



# --- discovered by aligning decoded text against a Unicode edition of the poem ---
for c, v in {229: 'म', 241: 'स', 236: 'व', 221: 'न', 235: 'ल', 232: 'ऱ', 220: 'ध', 238: 'ष', 189: 'ग',
             223: 'प', 202: 'ण', 193: 'ज', 227: 'ब', 192: 'च', 228: 'भ', 187: 'ख', 237: 'श', 251: 'श',
             207: 'थ', 191: 'घ', 249: 'ळ', 194: 'झ', 203: 'त', 250: 'क्ष', 205: 'त्र'}.items():
    add('H', c, v + D)
for c, v in {224: 'प्र', 233: 'रु', 234: 'रू', 204: 'त्र', 208: 'द्र', 213: 'द्ध', 186: 'क्त',
             243: 'स्त्र', 218: 'द्य', 222: 'न्न', 219: 'द्व', 225: 'प्त', 246: 'हृ', 252: 'श्च', 190: 'ग्न',
             248: 'ह्य', 216: 'द्भ', 212: 'द्द', 247: 'ह्म', 217: 'द्म', 210: 'द्ग', 214: 'द्ग', 209: 'दृ',
             240: 'ष्ठ', 239: 'ष्ट', 185: 'क्व', 215: 'द्ब', 184: 'क्क', 182: 'ङ्ग', 8222: 'ल्ल'}.items():
    add('L', c, v)
add('K', 171, '्र'); add('K', 179, '्न')
add('M', 161, 'ै'); add('M', 162, 'ैं'); add('M', 163, 'ै'); add('M', 93, 'ें'); add('M', 125, 'े')
add('M', 165, 'ृ'); add('M', 58, 'ः'); add('M', 62, ''); add('M', 36, '')
STEM = {206: ('त्त', 'त्त'), 8218: ('ज्ज', 'ज्ज'), 202: ('ण', 'ण')}   # half glyph + 'm' (stem) = full conjunct
for c, (v, _) in STEM.items(): add('H', c, v + D)
add('X', 254, '')
add('R', 169, 'र्'); add('R', 170, 'र्ं')
add('L', 339, 'श्व'); add('H', 352, 'क'+D); add('L', 8220, 'ङ्ग'); add('L', 402, 'च्च')
add('X', 8249, ''); add('X', 376, ''); add('X', 10, ' '); add('M', 8230, 'ः')
add('K', 231, '्य'); add('K', 180, '्र'); add('L', 253, 'श्न'); add('L', 200, 'ड्ड'); add('L', 197, 'ट्ट'); add('H', 226, 'फ'+D)


def decode(s):
    """Convert a legacy-encoded string to Unicode. Unknown glyphs become chr(0xE000+code)."""
    toks = [T.get(ord(ch), ('U', chr(0xE000 + ord(ch)))) for ch in s]
    out = []
    cluster_start = None
    closed = True
    pre = None
    i, n = 0, len(toks)
    while i < n:
        k, v = toks[i]
        if k == 'P':
            pre = v
        elif k in ('C', 'L', 'H'):
            if closed or cluster_start is None:
                cluster_start = len(out); closed = False
            if k == 'H' and ord(s[i]) in STEM and i + 1 < n and s[i + 1] == 'm':
                v = STEM[ord(s[i])][1]; k = 'L'; i += 1      # consume the stem glyph
            out.append(v)
            if k != 'H':
                closed = True
                while i + 1 < n and toks[i + 1][0] == 'K':
                    i += 1; out.append(toks[i][1])
                if pre:
                    out.append(pre); pre = None
        elif k == 'Q':   # reph + post-base matra glyph
            out.insert(cluster_start if cluster_start is not None else len(out), 'र्')
            out.append(v); closed = True
        elif k == 'R':
            if out and out[-1] == 'इ':
                out[-1] = 'ई' + ('ं' if v == 'र्ं' else '')
            elif v == 'र्ं':
                out.append('ं')
            else:
                out.insert(cluster_start if cluster_start is not None else len(out), v)
        elif k in ('M', 'K'):
            out.append(v); closed = True
        else:
            out.append(v); cluster_start = None; closed = True
        i += 1
    res = ''.join(out)
    for a, b in (('अा', 'आ'), ('आे', 'ओ'), ('आै', 'औ'), ('एे', 'ऐ'), ('ाे', 'ो'), ('ाै', 'ौ')):
        res = res.replace(a, b)
    res = re.sub('ं([ािीुूृेैोौ])', lambda m: m.group(1) + 'ं', res)   # anusvara after, not before, the vowel sign
    res = re.sub('([ैोौ])े', lambda m: m.group(1), res)   # redundant e-matra under ै / ो / ौ
    res = re.sub('े+', 'े', res)
    res = re.sub('ं+', 'ं', res)
    res = res.replace('ोें', 'ों')
    return res
