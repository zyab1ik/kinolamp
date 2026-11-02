#!/usr/bin/env python3
"""Import only public collection metadata from a locally saved categories page.

Save https://kino.watch/selection/categories as HTML Only in an authorized browser,
then run: python3 scripts/import-collection-categories.py /path/to/categories.html
The input may contain session data: never commit the original HTML.
"""
import argparse
from datetime import date
import html
import json
from pathlib import Path
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('html')
parser.add_argument('--date', default=date.today().isoformat())
args = parser.parse_args()
source = Path(args.html).read_text()
categories = []
for section_id, section in re.findall(r'<section[^>]+id="sc_([^"]+)"[^>]*>(.*?)</section>', source, re.S):
    heading = re.search(r'<h2[^>]*>\s*<span>(.*?)</span>', section, re.S)
    items = []
    for item_id, card in re.findall(r'<div class="kp-selection" id="selection_(\d+)">(.*?)(?=<div class="kp-selection"|</section>|$)', section, re.S):
        title = re.search(r'class="kp-poster-title"[^>]*>(.*?)</span>', card, re.S)
        poster = re.search(r'<img src="(https://m\.staticpop\.net/selection/[^"]+)"', card)
        counts = re.findall(r'class="kp-rating-pill"[^>]*>.*?</i>(.*?)</span>', card, re.S)
        if not title or not poster or len(counts) != 3:
            raise ValueError('Incomplete collection metadata: ' + item_id)
        items.append(dict(id=int(item_id), title=html.unescape(title[1]), posters=dict(medium=html.unescape(poster[1])), watchers=int(counts[0]), count=int(counts[1]), views=html.unescape(counts[2])))
    if not heading or not items:
        raise ValueError('Incomplete category: ' + section_id)
    categories.append(dict(id=section_id, title=html.unescape(heading[1]), items=items))
if len(categories) < 2:
    raise ValueError('No categories found; expected an authorized categories page')
result = "import type { Item } from './contracts.js';\n\n"
result += '// Public category membership and card order from kino.watch/selection/categories.\n'
result += f'// Snapshot: {date.fromisoformat(args.date).isoformat()}. Refresh with scripts/import-collection-categories.py.\n'
result += '// No account, session, CSRF, or subscription data is included.\n'
result += 'export var collectionCategories: { id: string; title: string; items: Item[] }[] = '
result += json.dumps(categories, ensure_ascii=False, indent=2) + ';\n'
Path('web/plugin/collection-categories.ts').write_text(result)
print(f'Imported {len(categories)} groups and {sum(len(c["items"]) for c in categories)} cards.')
