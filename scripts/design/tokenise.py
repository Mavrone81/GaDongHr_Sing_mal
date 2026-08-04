"""
Mechanical half of the Official Record conversion.

Handles ONLY the unambiguous token mapping — palette, shadows, radii. The
judgement half (cards -> sections, tables -> DataTable, warnings -> Notice,
statutory figures -> Seal) is done by hand afterwards; this pass exists so the
hand pass is spent on meaning rather than on 275 colour classes.

Mapping rationale:
  slate    -> the neutral scale: ink / muted / rule / page / shadow
  indigo   -> accent (the brand primary became the single action colour)
  emerald  -> accent  (accent IS deep green #1B4A3C, so "good" reads correctly)
  amber    -> highlight (#C08A3E) — the one sanctioned warning colour
  red/rose -> ink. There is no error colour in the system and seal red is
              RESERVED, so "bad" has to survive as words, not hue.
"""
import re
import sys

# Ordered: longest / most specific first. `(?:/\d+)?` eats opacity suffixes.
# Directional border colours (border-t-indigo-600, used by every spinner in the
# product) are NOT matched by a plain `border-<hue>` rule. Found the hard way on
# Wave A, where four spinners survived the pass; 26 other files carry the same
# pattern.
SIDES = r'(-[tblrxy])?'

# Every Tailwind hue. Hand-listing a few is how shadow-violet-500 and
# from-violet-600 survived into Wave D — the earlier rules named only the hues
# the screens converted so far happened to use.
HUES = (r'(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|'
        r'emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)')

RULES = [
    # ── shadows: removed entirely ─────────────────────────────────────────
    (r'\bshadow-(?:sm|md|lg|xl|2xl|inner|none)\b', ''),
    (r'\bshadow-' + HUES + r'-\d{2,3}(?:/\d+)?\b', ''),
    (r'\bshadow-(?:black|white)(?:/\d+)?\b', ''),
    (r'\bdrop-shadow(?:-\w+)?\b', ''),

    # ── radii: the system is not zero-radius, but only buttons and seals
    #    carry the 2px, and those come from the primitives. ──────────────
    (r'\brounded-(?:sm|md|lg|xl|2xl|3xl|full)\b', ''),
    (r'\brounded-\[(?!2px\])[^\]]+\]', ''),   # keep the sanctioned 2px
    (r'\brounded-[tlbr][lr]?-(?:sm|md|lg|xl|2xl|3xl|full)\b', ''),
    (r'\brounded(?![-\w])', ''),

    # ── neutral scale ─────────────────────────────────────────────────────
    (r'\btext-slate-(?:600|700|800|900|950)(?:/\d+)?\b', 'text-ink'),
    (r'\btext-slate-(?:300|400|500)(?:/\d+)?\b', 'text-muted'),
    (r'\btext-slate-(?:50|100|200)(?:/\d+)?\b', 'text-paper'),
    (r'\bbg-slate-(?:800|900|950)(?:/\d+)?\b', 'bg-shadow'),
    (r'\bbg-slate-(?:400|500|600|700)(?:/\d+)?\b', 'bg-muted'),
    (r'\bbg-slate-(?:200|300)(?:/\d+)?\b', 'bg-rule'),
    (r'\bbg-slate-(?:50|100)(?:/\d+)?\b', 'bg-page'),
    (r'\bborder' + SIDES + r'-slate-(?:700|800|900|950)(?:/\d+)?\b', 'border-shadow'),
    (r'\bborder' + SIDES + r'-slate-\d{2,3}(?:/\d+)?\b', lambda m, _t='rule': 'border' + (m.group(1) or '') + '-' + _t),
    (r'\bdivide-slate-\d{2,3}(?:/\d+)?\b', 'divide-rule'),
    (r'\bring-slate-\d{2,3}(?:/\d+)?\b', 'ring-rule'),
    # Gradient stops in ANY hue. A decorative gradient has no token to map
    # onto, so both stops collapse to one flat surface.
    # Each stop keeps its OWN prefix. Collapsing `from-x to-y` to `to-accent
    # to-accent` leaves the gradient with no start colour, so it fades in from
    # transparent — a decorative gradient becomes a rendering bug.
    # Both stops land on the same token, so the result is a flat surface.
    (r'\bfrom-' + HUES + r'-(?:50|100|200)(?:/\d+)?\b', 'from-page'),
    (r'\bvia-'  + HUES + r'-(?:50|100|200)(?:/\d+)?\b', 'via-page'),
    (r'\bto-'   + HUES + r'-(?:50|100|200)(?:/\d+)?\b', 'to-page'),
    (r'\bfrom-' + HUES + r'-\d{2,3}(?:/\d+)?\b', 'from-accent'),
    (r'\bvia-'  + HUES + r'-\d{2,3}(?:/\d+)?\b', 'via-accent'),
    (r'\bto-'   + HUES + r'-\d{2,3}(?:/\d+)?\b', 'to-accent'),

    # ── brand primary -> the single action colour ─────────────────────────
    (r'\btext-indigo-(?:50|100|200)(?:/\d+)?\b', 'text-paper'),
    (r'\btext-indigo-\d{2,3}(?:/\d+)?\b', 'text-accent'),
    (r'\bbg-indigo-(?:50|100|200)(?:/\d+)?\b', 'bg-page'),
    (r'\bbg-indigo-\d{2,3}(?:/\d+)?\b', 'bg-accent'),
    (r'\bborder' + SIDES + r'-indigo-\d{2,3}(?:/\d+)?\b', lambda m, _t='accent': 'border' + (m.group(1) or '') + '-' + _t),
    (r'\bring-indigo-\d{2,3}(?:/\d+)?\b', 'ring-accent'),

    # ── success -> accent (deep green) ────────────────────────────────────
    (r'\btext-emerald-\d{2,3}(?:/\d+)?\b', 'text-accent'),
    (r'\bbg-emerald-(?:50|100|200)(?:/\d+)?\b', 'bg-page'),
    (r'\bbg-emerald-\d{2,3}(?:/\d+)?\b', 'bg-accent'),
    (r'\bborder' + SIDES + r'-emerald-\d{2,3}(?:/\d+)?\b', lambda m, _t='accent': 'border' + (m.group(1) or '') + '-' + _t),
    (r'\bring-emerald-\d{2,3}(?:/\d+)?\b', 'ring-accent'),

    # ── warning -> highlight, the one sanctioned warning colour ───────────
    (r'\btext-(?:amber|yellow|orange)-(?:50|100|200|300)(?:/\d+)?\b', 'text-highlight'),
    (r'\btext-(?:amber|yellow|orange)-\d{2,3}(?:/\d+)?\b', 'text-ink'),
    (r'\bbg-(?:amber|yellow|orange)-(?:50|100|200)(?:/\d+)?\b', 'bg-page'),
    (r'\bbg-(?:amber|yellow|orange)-\d{2,3}(?:/\d+)?\b', 'bg-highlight'),
    (r'\bborder' + SIDES + r'-(?:amber|yellow|orange)-\d{2,3}(?:/\d+)?\b', lambda m, _t='highlight': 'border' + (m.group(1) or '') + '-' + _t),
    (r'\bdivide-(?:amber|yellow|orange)-\d{2,3}(?:/\d+)?\b', 'divide-rule'),
    (r'\bring-(?:amber|yellow|orange)-\d{2,3}(?:/\d+)?\b', 'ring-highlight'),

    # ── danger -> ink. No error colour exists; seal red is RESERVED. ──────
    (r'\btext-(?:red|rose|pink)-\d{2,3}(?:/\d+)?\b', 'text-ink'),
    (r'\bbg-(?:red|rose|pink)-(?:50|100|200)(?:/\d+)?\b', 'bg-page'),
    (r'\bbg-(?:red|rose|pink)-\d{2,3}(?:/\d+)?\b', 'bg-ink'),
    (r'\bborder' + SIDES + r'-(?:red|rose|pink)-\d{2,3}(?:/\d+)?\b', lambda m, _t='ink': 'border' + (m.group(1) or '') + '-' + _t),
    (r'\bring-(?:red|rose|pink)-\d{2,3}(?:/\d+)?\b', 'ring-ink'),

    # ── informational blues/violets -> accent ─────────────────────────────
    (r'\btext-(?:blue|sky|cyan|violet|purple|fuchsia|teal|lime|green)-\d{2,3}(?:/\d+)?\b', 'text-accent'),
    (r'\bbg-(?:blue|sky|cyan|violet|purple|fuchsia|teal|lime|green)-(?:50|100|200)(?:/\d+)?\b', 'bg-page'),
    (r'\bbg-(?:blue|sky|cyan|violet|purple|fuchsia|teal|lime|green)-\d{2,3}(?:/\d+)?\b', 'bg-accent'),
    (r'\bborder' + SIDES + r'-(?:blue|sky|cyan|violet|purple|fuchsia|teal|lime|green)-\d{2,3}(?:/\d+)?\b', lambda m, _t='accent': 'border' + (m.group(1) or '') + '-' + _t),
    (r'\bring-(?:blue|sky|cyan|violet|purple|fuchsia|teal|lime|green)-\d{2,3}(?:/\d+)?\b', 'ring-accent'),

    # ── accent-color (form controls). Not matched by the text/bg/border
    #    rules; slipped through in Waves B and C before being caught by hand. ─
    (r'\baccent-(?:indigo|blue|sky|cyan|violet|purple|teal|green|emerald)-\d{2,3}\b', 'accent-accent'),
    (r'\baccent-(?:amber|yellow|orange)-\d{2,3}\b', 'accent-highlight'),
    (r'\baccent-(?:red|rose|pink)-\d{2,3}\b', 'accent-ink'),
    (r'\baccent-slate-\d{2,3}\b', 'accent-muted'),

    # ── the surface itself ────────────────────────────────────────────────
    # PRESERVE the opacity suffix. `bg-white/5` is a 5% overlay on a dark card;
    # mapping it to a flat `bg-paper` turns a barely-there sheen into an opaque
    # cream panel. Dropping the suffix here silently wrecked the dark surfaces
    # in Waves A-C before it was caught.
    (r'\bbg-white(/\d+)?\b', lambda m: 'bg-paper' + (m.group(1) or '')),
    (r'\btext-white(/\d+)?\b', lambda m: 'text-paper' + (m.group(1) or '')),
    (r'\bborder-white(/\d+)?\b', lambda m: 'border-paper' + (m.group(1) or '')),
    (r'\bring-white(/\d+)?\b', lambda m: 'ring-paper' + (m.group(1) or '')),
    (r'\bdivide-white(/\d+)?\b', lambda m: 'divide-rule' + (m.group(1) or '')),
    (r'\bbg-black(/\d+)?\b', lambda m: 'bg-shadow' + (m.group(1) or '')),
    (r'\bborder-black(/\d+)?\b', lambda m: 'border-shadow' + (m.group(1) or '')),
    (r'\btext-black(/\d+)?\b', lambda m: 'text-ink' + (m.group(1) or '')),

    # ── placeholder colour in the older dash syntax ──────────────────────
    (r'\bplaceholder-' + HUES + r'-\d{2,3}(?:/\d+)?\b', 'placeholder-muted'),

    # ── CATCH-ALL. The rules above enumerate the Tailwind steps (50..950),
    #    so an off-scale step slips through: `bg-slate-750` is not a real
    #    class and never rendered, but it still trips the guard. These
    #    fallbacks mean no hue can survive the pass unnoticed. ─────────────
    (r'\btext-' + HUES + r'-\d{2,3}(?:/\d+)?\b', 'text-ink'),
    (r'\bbg-' + HUES + r'-\d{2,3}(?:/\d+)?\b', 'bg-page'),
    (r'\bborder' + SIDES + r'-' + HUES + r'-\d{2,3}(?:/\d+)?\b',
     lambda m: 'border' + (m.group(1) or '') + '-rule'),
    (r'\b(?:ring|divide|fill|stroke|caret|outline|accent)-' + HUES + r'-\d{2,3}(?:/\d+)?\b', 'text-muted'),

    # ── decorative blur washes: the gradient overlays the design retires ──
    (r'\bblur-(?:sm|md|lg|xl|2xl|3xl)\b', ''),
]

COMPILED = [(re.compile(p), r) for p, r in RULES]


# Deleting a class leaves a gap. Tidy it ONLY inside class-name strings —
# a blanket whitespace collapse would eat the spaces inside user-facing prose.
CLASS_STR = re.compile(r'''(?P<q>["'`])(?P<body>[^"'`\n]*?)(?P=q)''')


def tidy_classes(text: str) -> str:
    CLASSY = re.compile(r'\b(?:text|bg|border|px|py|pt|pb|pl|pr|mx|my|mt|mb|w|h|gap|flex|grid|font|items|justify|tracking|uppercase|absolute|relative|fixed|inline|hidden|divide|ring|overflow)\b')

    def fix(m):
        body = m.group('body')
        # Only touch strings that are demonstrably class lists, never prose,
        # and only where a deletion actually left a gap. Stripping a string
        # like " of " would silently remove a space the UI needs.
        if not re.fullmatch(r'[\s\w:/\[\]\.\-%\(\),#!]*', body):
            return m.group(0)
        if not CLASSY.search(body):
            return m.group(0)
        if not re.search(r'[ \t]{2,}|^[ \t]|[ \t]$', body):
            return m.group(0)
        # PRESERVE a single leading/trailing space. A class string is often
        # CONCATENATED (`const SX = IX + ' cursor-pointer ...'`), and stripping
        # that space silently fuses two class names into one nonexistent class.
        # Caught in Wave C; it produced no type error and no test failure.
        lead = ' ' if body[:1] in ' \t' else ''
        trail = ' ' if body[-1:] in ' \t' else ''
        cleaned = re.sub(r'[ \t]{2,}', ' ', body).strip()
        return f"{m.group('q')}{lead}{cleaned}{trail}{m.group('q')}"
    return CLASS_STR.sub(fix, text)


SPINNER = re.compile(r'className=(["\'`])([^"\'`]*animate-spin[^"\'`]*)\1')


def restore_spinners(before: str, after: str) -> str:
    """Give `rounded-full` back to loading spinners.

    "Nothing but buttons and seals is rounded" is about CARDS. A spinner is a
    circle because it rotates; stripping its radius turns it into a spinning
    square. 58 of them were square before this was caught.
    """
    had = {m.group(2) for m in SPINNER.finditer(before) if 'rounded-full' in m.group(2)}
    if not had:
        return after

    def fix(m):
        body = m.group(2)
        if 'rounded-full' in body:
            return m.group(0)
        return m.group(0).replace(body, body.rstrip() + ' rounded-full')
    return SPINNER.sub(fix, after)


def convert(text: str) -> str:
    original = text
    for pat, rep in COMPILED:
        text = pat.sub(rep, text)
    return restore_spinners(original, tidy_classes(text))


for path in sys.argv[1:]:
    with open(path) as fh:
        original = fh.read()
    converted = convert(original)
    with open(path, 'w') as fh:
        fh.write(converted)
    print(f'{path}: {len(original)} -> {len(converted)} bytes')
