# Task

Read the DOM structure of the HTML article view (the input file named by the task) and convert the **content to convert** into a **markdown skeleton** — an array in document order, each item a single-key object whose key is a semantic label and whose value is the block's content template. Placeholders (`{{LONG_TEXT_k|…}} / {{CODE_k|…}} / {{TABLE_k|…}}`) reference only the placeholder index, with all suffixes (including `|`) removed.

## Terminology

**"Paragraph block"**: every direct child of `<body>` is a "paragraph block". Each paragraph block may contain independent "sub-paragraphs" (`h1-h6` / `p` / `span` / `blockquote` / `ul` / `ol` / `pre>code` / `table` / `img`); each sub-paragraph is Markdown text on **its own line** (a `span` sub-paragraph maps to a `p` entry); **content that cannot be expressed as sub-paragraphs is screenshotted wholesale into a Markdown image** (`trans2img`).

DOM structure example:
```html
<body>
<!-- paragraph block [1], containing two sub-paragraphs: `h1` / `p` -->
<div data-idx="1"><h1>…</h1><p>…</p></div>
<!-- paragraph block [10], containing two sub-paragraphs: `img` / `pre` -->
<section data-idx="10"><img src="…"/><pre>…</pre></section>
<!-- paragraph block [20], cannot be split further into sub-paragraphs -->
<ol data-idx="20">…</ol>
</body>
```

**"Block styling"**: "background / border / border-radius / shadow"

## Chunk context (present only in chunked input)

**The content to convert may be surrounded by context (paragraph blocks inside HTML comments `<!-- … -->`) for your reference — do NOT convert them!** Context paragraph blocks are **for understanding only** — they establish the heading hierarchy, the font-size baseline, and the surrounding narrative:

- **Produce no entries**: context paragraph blocks do not count as omissions under "each piece maps to exactly one entry"; same standing as the chrome exemption
- **Never reference indices**: `{{LONG_TEXT/TABLE/CODE}}` indices appearing in context paragraph blocks are never referenced (the corresponding chunk owns them)
- Convert only the paragraph blocks **between the ✅ and ❌ marker comments**; when no marker comments exist, convert everything

## Vocabulary:

| key | value |
|---|---|
| `h1 - h6` | Heading content: `# xxx` |
| `p` | Paragraph content |
| `blockquote` | Quotation content: `> xxx` |
| `ul` / `ol` | List body (one item per line, written in one string): `- xxx\n- xxx` / `1. xxx\n2. xxx` |
| `img` | Absolute image URL: `![img](url)`|
| `code` | Language + standalone code content: `{"lang": "tsx", "content": "…"}` |
| `table` | Full markdown table: including the `|--|--|` separator row |
| `trans2img` | Standalone complex visual module: takes the `data-idx` values of the "screenshot boundary chain" (an integer array) |

- Preserve the original `HTML` document order; do not alter the original meaning
- The key is the result of **semantic judgment**, decided per the **decision rules** below
- The value carries Markdown syntax: block-level syntax (`#`, `>`, `-`, `1.`, `![img](url)`, etc.) and inline formatting (`**bold**`, `[link text](url)`, inline code, etc.) are all written into the value
- "Long-text" placeholders **reference the index only** (without the statistics suffix): `{{LONG_TEXT_5|…}}` → `{{LONG_TEXT_5}}`; **every index is globally unique and referenced exactly once** (except indices inside a `trans2img` subtree — the original text is preserved via the screenshot, not referenced, no entry produced)
- Once referenced, LONG_TEXT indices are restored by step 5's **deterministic conversion**: for a run-folded index (a whole-run placeholder of a mixed inline paragraph), just write `{"p": "{{LONG_TEXT_k}}"}` — do **not** attempt to restore its inline formatting yourself (bold/italic/links/inline code/`$formula$` are all produced by the converter); for unfolded content (including paragraphs with source-less formulas and short text), keep writing inline formatting by hand
- Short text (below the long-text placeholder threshold) and URLs → copy verbatim
- Math formulas: LaTeX in the input is already in `$…$` text form — copy the source verbatim, do not transcribe into plain text; a display-level formula may become its own `p` entry with value `$$…$$`
- "Each piece maps to exactly one entry, no duplicates or omissions" refers to **body content**: every piece of body content yields exactly one entry, and every LONG_TEXT index is referenced exactly once; the following chrome is **exempt** (no entries, URLs/indices inside are not referenced, not counted as omissions): UI-control text that carries no real content (share/like/copy-type buttons), decorative inline mini-icons

## Decision rules

Judge each "paragraph block" one by one and produce entries. When multiple **decision sections** match, take the **first match** in this section's top-to-bottom order; within each section, entries are ordered "general rule → exception/refinement", and **exceptions override general rules** (e.g. an h tag is generally judged `h1-h6`, but as a module-internal heading the exception says not to). `trans2img` is the final fallback — content that cannot be expressed as "sub-paragraphs" is screenshotted wholesale into a Markdown image.

### `h1 - h6` decision

- Carries an explicit `h1 - h6` tag → `h1 - h6`
- Font size at an `h1 - h6` level → `h1 - h6`
- Multi-sentence long text (lead-in/summary) is judged `p` even with a larger font (e.g. 1.1-1.25rem) — size-based leveling applies only to short heading phrases
- A **purely decorative** numbered badge beside the heading (e.g. an "01" circular numeral) is not merged into the heading text; but a **semantic section number** (e.g. "5.1", "§4.4", targetable by cross-references in the body) stays inside the heading text
- An `h` tag serving as a **module-internal heading/label** (code-block title bar, card title, panel title, etc.) is not judged `h1-h6`; it follows the module's form: code-block title bar → `p`, card/list-item title → list-item text; `h1-h6` is reserved for document-structural headings
- Tie-breaker for bold short labels when unsure between `h` and `p`: font size not above the body's regular size and not governing any subsequent content hierarchy (badge-style section names, closing/lead-in labels) → `p` (keep the bold)

Rough font-size mapping (based on browser defaults; when the whole site's sizes are shifted, level by in-page relative size; 1rem/16px is usually the body's regular size — combine with boldness/semantics before leveling):

| Font size (approx.) | Decision |
|---|---|
| 2rem / 32px | `h1` |
| 1.5rem / 24px | `h2` |
| 1.17rem / 19px | `h3` |
| 1rem / 16px | `h4` |
| 0.83rem / 13px | `h5` |
| 0.67rem / 11px | `h6` |

Values between two levels go to the nearer one (e.g. 28px → nearer 32px → `h1`; 21px → nearer 24px → `h2`); when the site scales font sizes or the body text is not the usual 16px, first locate the body's regular size as the **`h4` baseline** and level the rest proportionally.

DOM structure example:
```html
<body>
<div>
  <div>
    <!-- judged h1 -->
    <span style="font-size: 32px;">
      <span>{{LONG_TEXT_1}}</span>
    </span>
    <!-- font size 2rem reaches the h1 level, likewise judged h1 -->
    <p style="font-size: 2rem;">
      <span>{{LONG_TEXT_2}}</span>
    </p>
  </div>
  <div>
    <!-- judged h2 -->
    <h2>Section heading…</h2>
  </div>
</div>
</body>
```

Output example:
```json
{"h1": "# {{LONG_TEXT_1}}"},
{"h1": "# {{LONG_TEXT_2}}"},
{"h2": "## Section heading…"}
```

### `blockquote` decision

- Explicit `<blockquote>` tag → `blockquote`
- `<aside>`-style semantic aside/marginal-note tags → `blockquote` (even without block styling)
- Inside the "paragraph block" there is exactly **one layer** wrapped in "block styling" (the paragraph block itself, or one child layer; no other "block styling" layer anywhere else in the paragraph block — neither wrapping this one nor nested deeper), and all descendants are text-form elements (`p`/`span`/`h1-h6`/text nodes; no images/tables/code blocks/lists) → `blockquote` (an `h` inside the block merges into the quotation text; no separate `h` entry)

DOM structure example:
```html
<body>
<div>
  <blockquote style="border: xxx;">
    <p>{{LONG_TEXT_1}}</p>
    <p>{{LONG_TEXT_2}}</p>
  </blockquote>
</div>
<div>
  <div style="border-left: xxx;">
    <p>{{LONG_TEXT_3}}</p>
  </div>
</div>
<div>
  <div style="background-color: xxx;">
    <p>{{LONG_TEXT_4}}</p>
    <p>{{LONG_TEXT_5}}</p>
  </div>
</div>
</body>
```

Output example:
```json
{"blockquote": "> {{LONG_TEXT_1}}\n> {{LONG_TEXT_2}}"},
{"blockquote": "> {{LONG_TEXT_3}}"},
{"blockquote": "> {{LONG_TEXT_4}}\n> {{LONG_TEXT_5}}"}
```

### `ul` / `ol` decision

- Real list tags: `<ul>`/`<ol>`/`<li>` → `ul`/`ol`; ordered semantics (steps, rankings, numbering) → `ol`; unordered → `ul`
- Multiple child panels inside the "paragraph block" whose content is **text-dominant** (text carries the main information: a title + ≥1 sentence of description, etc.) → per text-form-first **over screenshots** → `ul`/`ol` (reversed when images dominate, see the counter-example in the `trans2img` decision);
- Inside the "paragraph block", no list tags but children are **structurally repeated** and carry **list-feature signals** — numbering prefixes (`1.`/`01`-style), bullet/item-marker prefixes (●/•/–/✓-style), or leading mini-icons acting as bullets — as entries made of multiple plain-text lines ("card groups, vertically stacked icon+text rows, key-point rundowns, tag groups, etc."), expressible with multi-level `ul` / `ol` → `ul`/`ol` (the source's list markers are converted to markdown line syntax `- ` / `1. `, not copied verbatim into the value); run-on full-sentence body paragraphs **without list-feature signals** → multiple `p` entries, not a list
- Repeated "label: value" metadata lines (author/date/view count, etc.) → converge into a single `p` entry (e.g. "Author: X · Date: Y · Views: Z"), not a list
- The value is **one string**: one item per line, `\n`-separated, **no leading spaces on same-level items**; the line-level `- ` / `1. ` syntax is written into the value; nested lists are expressed by indentation (2 spaces per level) inside the same string; an item's **continuation lines** (e.g. description text inside a card) are likewise indented 2 spaces, without list markers

DOM structure example:

```html
<body>
  <ol>
    <li>{{LONG_TEXT_10}}</li>
    <li>{{LONG_TEXT_11}}</li>
  </ol>
  <div>
    <p>● <span>{{LONG_TEXT_12}}</span></p>
    <p>● <span>{{LONG_TEXT_13}}</span></p>
  </div>

<div data-idx="30" style="display: flex">
  <div data-idx="31">
    <div>
      <p>Title_1…</p>
      <img src="https://example.com/i/icon-1.png" style="width: 24px; height: 24px;">
      <span>{{LONG_TEXT_14}}</span>
    </div>
    <div>
      <p>Title_2…</p>
      <img src="https://example.com/i/icon-2.png" style="width: 24px; height: 24px;">
      <span>{{LONG_TEXT_15}}</span>
    </div>
  </div>
</div>
</body>
```

Output example:
```json
{"ol": "1. {{LONG_TEXT_10}}\n2. {{LONG_TEXT_11}}"},
{"ul": "- {{LONG_TEXT_12}}\n- {{LONG_TEXT_13}}"},
{"ul": "- Title_1…\n  {{LONG_TEXT_14}}\n- Title_2…\n  {{LONG_TEXT_15}}"}
```

### `img` decision

- `<img>` / `<picture>` elements: the value is uniformly `![img](absolute image URL)` (the URL is the src already absolutized during the snapshot stage; for `<picture>` always take the inner `<img>`'s `src`, ignoring `srcset`/`<source>` candidates) → `img`;
- `<figure><img>` + `<figcaption>`: expand into two entries — the `img` entry + a `p` entry for the figcaption → `img`;
- `<figure>` wrapping other content expands the same way: the content becomes entries per its own type (`blockquote`/`table`/`pre`, etc.), `figcaption` → `p`;
- Inline mini-icons / decorative icons accompanying text do not become their own `img` entries
- The `style` width/height kept on `<img>` is a signal for judging image weight; bucket by the shorter side (reference values): **≤48px → icon-level**, inline mini-icons get no separate entry; **≥240px or width close to the content area → large image**, a standalone `img` entry; in between is medium — many gathered together → lean toward a `trans2img` image group
- Multiple images forming one visual whole with little text (image groups, image-text collages) → `trans2img`; do not split them into per-image `img`s; CSS background images likewise (no standalone URL to extract)

DOM example:
```html
<body>
<figure>
  <img src="https://example.com/a/cover.png">
  <figcaption>{{LONG_TEXT_20}}</figcaption>
</figure>
<p><img src="https://example.com/a/diagram.png"></p>
</body>
```

Output structure example:
```json
{"img": "![img](https://example.com/a/cover.png)"},
{"p": "{{LONG_TEXT_20}}"},
{"img": "![img](https://example.com/a/diagram.png)"}
```

### `code` decision

- Seeing the `pre>code>{{CODE_k|N_lines}}` placeholder → emit `{{CODE_k}}`, stripping the `|N_lines` suffix; **do not convert it yourself**
- The "paragraph block" mainly consists of a "code block `pre>code>…` + title/description text" → formatted `code` + `p`; the "title/description text" may be absent
  - `lang` is required: prefer the `data-language` attribute on `pre` / `code`; write `""` when there is no clue
  - A `pre` with its own background/border does not change the decision (same as `table`); still `code`
  - Copy the code verbatim: if the source has glued/damaged spacing, copy it as-is; only delete the leading line numbers, never repair anything
  - Long text inside code references placeholders as usual (`content` may contain `{{LONG_TEXT_k}}`)

DOM structure example:
```html
<body>
<!-- a raw `pre>code>…` code block → formatted `code…` -->
<section style="background-color: xxx; border: xxx;">
  <div style="border-bottom: xxx">
    <p>{{LONG_TEXT_6}}</p>
  </div>
  <pre style="background-color: xxx;">
    <code><span>code</span>…</code>
  </pre>
</section>

<!-- the `pre>code>{{CODE_k|N_lines}}` placeholder → `{{CODE_k}}` -->
<section style="background-color: xxx; border: xxx;">
  <div style="background-color: xxx;">
    <pre>
      <code data-language="lang">{{CODE_k|N_lines}}</code>
    </pre>
  </div>
  <p style="border-top: xxx">{{LONG_TEXT_7}}</p>
</section>
</body>
```

Output example:
```json
{"p": "{{LONG_TEXT_6}}"},
{"code": {"lang": "lang", "content": "[formatted]code…"}},
{"code": {"lang": "lang", "content": "{{CODE_k}}"}},
{"p": "{{LONG_TEXT_7}}"}
```

### `table` decision

- Seeing the `{{TABLE_k|rows×cols}}` placeholder → emit `{{TABLE_k}}`, stripping the `|rows×cols` suffix; **do not convert it yourself**
- The "paragraph block" mainly consists of a "table block (`table>…`) + title/description text" → formatted `table` + `p`; the "title/description text" may be absent
  - Footnote anchors inside cells (e.g. `[*](#...)`) keep the link form; do not degrade to a bare `*`
  - Long text inside cells references placeholders as usual (the table value may contain `{{LONG_TEXT_k}}`)
  - Escape `|` inside cell text as `\|`; write line breaks as `<br>`
- Nested tables, or block-level content inside cells (lists/multi-paragraphs/images, etc.) that a GFM pipe table cannot express → fall back to `trans2img` (see that section's decision for the screenshot chain)

DOM structure example:
```html
<body>
<!-- a raw `table>…` table → a formatted markdown table -->
<section style="background-color: xxx; border: xxx;">
  <div style="border-bottom: xxx">
    <p>{{LONG_TEXT_8}}</p>
  </div>
  <table style="border: xxx;">
    <thead>
      <tr><th>Metric</th><th>Value</th></tr>
    </thead>
    <tbody>
      <tr><td>Revenue<a href="#fn1">*</a></td><td>120M</td></tr>
      <tr><td>{{LONG_TEXT_9}}</td><td>{{LONG_TEXT_10}}</td></tr>
    </tbody>
  </table>
</section>

<!-- the `{{TABLE_5|3×2}}` placeholder → `{{TABLE_5}}` -->
<section style="background-color: xxx; border: xxx;">
  <div style="background-color: xxx;">
    {{TABLE_5|3×2}}
  </div>
  <p style="border-top: xxx">{{LONG_TEXT_11}}</p>
</section>
</body>
```

Output example:
```json
{"p": "{{LONG_TEXT_8}}"},
{"table": "|Metric|Value|\n|--|--|\n|Revenue[*](#fn1)|120M|\n|{{LONG_TEXT_9}}|{{LONG_TEXT_10}}|"},
{"table": "{{TABLE_5}}"},
{"p": "{{LONG_TEXT_11}}"}
```

### Combination patterns

- When the "paragraph block" holds a single `<table>` / `<pre>` / `<img>` and the remaining siblings are plain text paragraphs (`p/h/blockquote`-like, `block > p > span > text…`) → split into the corresponding entry combination: the `table` / `code` / `img` entry (`pre` maps to a `code` entry) + `p` / `h1-h6` / `blockquote` text entries
- When the "paragraph block" holds **standalone, multi-line** text content (element combinations like `h1` + `pre` + `p` + `blockquote` + `button`, spread across `section` / `header` / `div` / `footer` layers) with **no multi-level "block styling"** → an `h1+code+p+blockquote` combination (`pre` maps to a `code` entry)
- An expander/collapser (accordion) heading is **not** a UI control — it is a content heading: level the `h` by in-page relative hierarchy (usually one level below the nearest preceding structural heading; nested accordions one level lower again)

DOM structure example (four decision scenarios in one `<body>`):
```html
<body>

<!-- example 1: a single <pre> sharing a "paragraph block" with plain-text siblings (h2 / p) → split into h2 + code + p -->
<div>
  <h2>{{LONG_TEXT_30}}</h2>
  <pre><code data-language="js">const a = 1;</code></pre>
  <p>{{LONG_TEXT_31}}</p>
</div>

<!-- example 2: standalone, multi-line text runs (h1/pre/p/blockquote/button), no multi-level "block styling" → h1/code/p/blockquote; the "Share" button is a UI control — its text produces no entry unless the button carries valid text content -->
<section>
  <header>
    <h1>{{LONG_TEXT_32}}</h1>
  </header>
  <div>
    <pre><code>{{CODE_4|N_lines}}</code></pre>
  </div>
</section>
<section>
  <div>
    <p>{{LONG_TEXT_33}}</p>
  </div>
  <blockquote><p>{{LONG_TEXT_34}}</p></blockquote>
  <footer>
    <button>Share</button>
  </footer>
</section>

<!-- example 3: an accordion heading is a content heading, not a UI control — carrying an h2 tag it is judged h2 by tag level; the nested accordion heading (bare text, no tag) is judged one level below its parent → h3 -->
<div>
  <button aria-expanded="true">
    <svg></svg>
    <h2>Accordion heading A</h2>
  </button>
  <div>
    <p>{{LONG_TEXT_40}}</p>
    <div>
      <button aria-expanded="false">Nested accordion heading</button>
      <div><p>{{LONG_TEXT_41}}</p></div>
    </div>
  </div>
</div>
</body>
```

Output example (in document order):
```json
{"h2": "## {{LONG_TEXT_30}}"},
{"code": {"lang": "js", "content": "const a = 1;"}},
{"p": "{{LONG_TEXT_31}}"},
{"h1": "# {{LONG_TEXT_32}}"},
{"code": {"lang": "", "content": "{{CODE_4}}"}},
{"p": "{{LONG_TEXT_33}}"},
{"blockquote": "> {{LONG_TEXT_34}}"},
{"h2": "## Accordion heading A"},
{"p": "{{LONG_TEXT_40}}"},
{"h3": "### Nested accordion heading"},
{"p": "{{LONG_TEXT_41}}"}
```

### `trans2img` decision

> `trans2img` screenshots a module wholesale when it cannot be expressed in Markdown.

- **None of the preceding decisions match, i.e. the content cannot be expressed as "sub-paragraphs"** → `trans2img`
- **Counter-example — "text-form-first" reverses when images dominate**: when content is **image-dominant** (image area prevails, text reduced to short labels — ≲1 short line per card) with little or no text, even if a few splittable text sub-paragraphs are interspersed, **prefer `trans2img` wholesale** instead of splitting out text entries; "text-form-first" applies only to text-dominant "paragraph blocks"
- Image groups and image-text collages with "little/no" plain text; CSS background images likewise (no standalone URL to extract) → `trans2img`
- Charts, flows, diagrams, and card collages whose meaning is spatial → `trans2img`
- **Multi-level "block styling"**: a complex layout with ≥2 **nested** layers carrying "block styling" inside the "paragraph block", or **≥2 parallel** child panels each carrying "block styling" (comparison panels, card grids) → `trans2img`; not applicable when the block's main body is a single `pre`/`table` — that goes through the `code`/`table` + combination-pattern decisions, the styled layers being mere shell decoration
- Contains special elements like `canvas`/`iframe` → `trans2img`; the screenshot boundary is **pinned to the "paragraph block"**, chain = [paragraph block]
- Card groups whose main content is images with short text → `trans2img`
- The "paragraph block" subtree contains **content-bearing** "absolutely positioned" elements (floating annotations, overlay cards, positioned image-text collages — spatially stacked over other content) → `trans2img`; purely decorative absolute positioning (background decorations, color blocks, glows with no text/image content) does not trigger it
- Row-column aligned grid data (not a `<table>` tag) → `trans2img`
- Contains UI interactive controls — meaning **pure mutually-exclusive selectors** only: tab groups, dropdown/toggle triggers, radio groups, language switches, etc. (`role="group"` / `role="button"` / `role="tablist"` / `role="radiogroup"`-like); screenshot the "paragraph block" whole → `trans2img` — **the boundary is pinned to the "paragraph block"; do not split first-level "title/description"** (the UI control and the content panel are one unit; first-level text is absorbed into the screenshot, no entries)

**`trans2img` ID value rules**

- **`trans2img` takes an array from the "screenshot boundary chain"**, ordered **from the outermost chain head (the paragraph block or one of its children) to the innermost chain tail (the multi-child container)**
- The "screenshot boundary chain" has at least one ID; the values are usually consecutive `+1`/`+2` increments
- The value must be a **JSON integer array** (e.g. `[1, 2, 4]`) — the `data-idx` attribute is a string in HTML; when written into the skeleton it must be numbers, never an array of strings
- When the chain head is itself a multi-child container, the chain has a single element

> **"Screenshot boundary chain"**: for a visual module headed to `trans2img`, the chain = every element passed while descending level by level from the **chain head** to the **chain tail** (both ends included) — it frames the module's overall screenshot boundary, and every `data-idx` on the chain is one candidate screenshot. Each level below the chain head **wraps only this module**: sibling elements off the chain path carry no valid content.

**First-level children fall into two kinds**: ① **text-form children** ("title/description") — first-level direct children in text form like `h1-h6`/`p`/short text lines (excluding mini-icons and UI controls); ② **complex modules** — content children not expressible as "sub-paragraphs" (charts, card groups, collages, etc.).
**Chain head**: by default the "paragraph block" element. **The shift-down rule always applies** — when the first level has text-form children and exactly **1** complex module, the chain head shifts down to that module (**one shift only**, see the examples below), and the text-form children become standalone entries (`p/h/blockquote`). **The only exceptions**: ≥2 first-level complex modules, or UI interactive controls present — no shift, and no splitting of title/description either; the boundary is **pinned to the "paragraph block" whole**, chain = [paragraph block] as a single ID, and all first-level text is absorbed into the screenshot (scrolling content must be captured whole). When the paragraph block itself is the visual subject (e.g. it carries a `background-image`) and the first level has only text-form children with no complex module to shift down to → chain = [paragraph block]; the first-level text is part of the module's internal composition and is absorbed into the screenshot.
**Title/description splitting happens only at the first level**: a title/description that can be split into a standalone one-line entry must be a **direct child of the "paragraph block"**; titles/descriptions below the second level cannot be split (absorbed into the module screenshot); a UI control never counts as title/description.
**Chain tail**: usually a "multi-child container"; descend level by level from the chain head — an empty element with no valid content (no text/icons/images in the subtree) is treated as absent (not on the chain); a single valid child → pass through and keep descending (it stays on the chain); multiple valid children → stop at that element; it is the **chain-tail module container**

DOM structure example (screenshot boundary chain):
```html
<body>
<!-- normal case: no first-level "title/description", the trans2img value is `[1,2,4]` -->
<!-- the "paragraph block" serves as the default chain head -->
<section data-idx="1" style="background-color: xxx; border: xxx">
  <!-- no first-level "title/description", keep descending -->
  <div data-idx="2">
    <!-- invalid element [3], removed from the "screenshot boundary chain", keep descending -->
    <div data-idx="3"><span></span></div>
    <!-- multiple valid children [4], stop descending — chain tail -->
    <div data-idx="4">
      <div data-idx="5"><span>…</span></div>
      <div data-idx="6"><span>…</span></div>
    </div>
  </div>
</section>

<!-- first level has "title/description", the trans2img value is `[9,10]` -->
<div data-idx="7">
  <!-- first level has a "title" -->
  <h2 data-idx="8">Title…</h2>
  <!-- first level has "title/description": the chain head shifts down from the "paragraph block" [7] to the non-"title/description" child [9] -->
  <section data-idx="9">
    <!-- multiple valid children [10], stop descending — chain tail -->
    <div data-idx="10">
      <div data-idx="11"><span>…</span></div>
      <div data-idx="12"><span>…</span></div>
    </div>
  </section>
  <!-- first level has a "description" -->
  <div data-idx="13"><span>{{LONG_TEXT_2}}</span></div>
</div>

<!-- first level has a "title" + multiple complex modules → no shift, no "title/description" split; the screenshot is pinned to the "paragraph block" whole, value `[14]` -->
<div data-idx="14">
  <h2 data-idx="15">Title…</h2>
  <section data-idx="16" style="background-color: xxx; border: xxx">…Chart A…</section>
  <section data-idx="17" style="background-color: xxx; border: xxx">…Chart B…</section>
</div>

<!-- a visual module nested inside an expander: the expander heading is a first-level "title" (content heading, not a UI control) → standalone h entry; the chain head shifts down into the panel, value `[20,21]` -->
<div data-idx="18">
  <button data-idx="19">Accordion heading</button>
  <div data-idx="20">
    <section data-idx="21" style="background-color: xxx; border: xxx">
      <img src="https://example.com/a/chart.png">
      <div>…legend…</div>
    </section>
  </div>
</div>
</body>
```

Output example:
```json
{"trans2img": [1, 2, 4]},
{"h2": "## Title…"},
{"trans2img": [9, 10]},
{"p": "{{LONG_TEXT_2}}"},
{"trans2img": [14]},
{"h3": "### Accordion heading"},
{"trans2img": [20, 21]}
```

DOM structure example (`trans2img` decision scenarios):
```html
<body>

<!-- example 1: image-text collage / image group (little plain text, CSS grid; multiple figures forming one visual whole) → trans2img, chain [20,21]; figcaption short text is absorbed into the screenshot, no per-image img splits -->
<div data-idx="20" style="display: grid;">
  <div data-idx="21">
    <figure data-idx="22"><img src="https://example.com/a/a.png"><figcaption>SHORT…</figcaption></figure>
    <figure data-idx="23"><img src="https://example.com/a/b.png"><figcaption>SHORT…</figcaption></figure>
  </div>
</div>

<!-- example 2: CSS background image (no standalone URL to extract); the paragraph block itself is the visual subject; first level has only text-form children, no complex module to shift down to → trans2img, chain pinned to [24]; banner title/short phrases absorbed into the screenshot -->
<div data-idx="24" style="background-image: url(https://example.com/a/banner.png);">
  <div data-idx="25"><span>Banner title</span></div>
  <p data-idx="26">SHORT…</p>
</div>

<!-- example 3: ≥2 parallel comparison panels with "block styling" (card grid, chart/image-based meaning) → trans2img, chain [30,31] -->
<div data-idx="30">
  <div data-idx="31" style="display: flex;">
    <div data-idx="32" style="background-color: xxx; border: xxx;">
      <img src="https://example.com/a/m1.png" style="width: 320px; height: 180px;"><div>Metric card A</div>
    </div>
    <div data-idx="33" style="background-color: xxx; border: xxx;">
      <img src="https://example.com/a/m2.png" style="width: 320px; height: 180px;"><div>Metric card B</div>
    </div>
  </div>
</div>

<!-- example 4: contains the special canvas element (chart + legend) → trans2img; boundary pinned to the paragraph block, chain [40] -->
<div data-idx="40" style="border: xxx;">
  <canvas data-idx="41" width="600" height="300"></canvas>
  <div data-idx="42"><span>● Revenue　● Expense</span></div>
</div>

<!-- example 5: an "absolutely positioned" element among descendants (floating annotation) → trans2img, chain [50,51] -->
<div data-idx="50">
  <div data-idx="51" style="position: relative;">
    <img data-idx="52" src="https://example.com/a/diagram.png">
    <div data-idx="53" style="position: absolute; top: 0; left: 0;">Annotation</div>
  </div>
</div>

<!-- example 6: row-column aligned grid data (divs simulating a table, not a <table> tag) → trans2img, chain [60,61] -->
<div data-idx="60">
  <div data-idx="61" style="display: grid; grid-template-columns: repeat(3, 1fr);">
    <div data-idx="62" style="border: xxx;">Q1</div><div data-idx="63" style="border: xxx;">1.2</div><div data-idx="64" style="border: xxx;">+8%</div>
    <div data-idx="65" style="border: xxx;">Q2</div><div data-idx="66" style="border: xxx;">1.5</div><div data-idx="67" style="border: xxx;">+12%</div>
  </div>
</div>

<!-- example 7: multiple parallel data panels sharing a title/summary line → the whole group is one module, one trans2img, the chain converges on the container holding all panels [70,71]; the title [72]/summary [76] sit inside the module container (not at the paragraph block's first level), absorbed into the screenshot, no separate entries -->
<div data-idx="70">
  <div data-idx="71">
    <h3 data-idx="72">Quarterly comparison</h3>
    <div data-idx="73" style="display: flex;">
      <div data-idx="74" style="border: xxx;"><img src="https://example.com/a/c1.png"></div>
      <div data-idx="75" style="border: xxx;"><img src="https://example.com/a/c2.png"></div>
    </div>
    <p data-idx="76">Summary: 10% YoY growth for the full year</p>
  </div>
</div>

<!-- example 8: pure mutually-exclusive selector (language-switch segmented control, role="group"/"button") → trans2img; the screenshot is pinned to the paragraph block [80], and [82]'s text is absorbed into it -->
<div data-idx="80">
  <div data-idx="81" role="group">
    <button role="button" aria-pressed="true">中文</button>
    <button role="button">English</button>
  </div>
  <section data-idx="82">
    <p data-idx="83">SHORT…</p>
    <p data-idx="84">SHORT…</p>
  </section>
</div>
</body>
```

Output example (in document order):
```json
{"trans2img": [20, 21]},
{"trans2img": [24]},
{"trans2img": [30, 31]},
{"trans2img": [40]},
{"trans2img": [50, 51]},
{"trans2img": [60, 61]},
{"trans2img": [70, 71]},
{"trans2img": [80]}
```

## Output requirements

Output path: as specified by the task (same number as the input chunk)

Full JSON structure:

```json
[
  {"h1": "# {{LONG_TEXT_1}}"},
  {"p": "Author: Name · Date: 1945/08/01"},
  {"img": "![img](https://example.com/a/cover.png)"},
  {"blockquote": "> {{LONG_TEXT_4}}"},
  {"code": {"lang": "python", "content": "def hello():\n    print('hi')"}},
  {"table": "|Quarter|Revenue|\n|--|--|\n|Q1|120M|"},
  {"ul": "- {{LONG_TEXT_10}}\n- {{LONG_TEXT_11}}"},
  {"trans2img": [8, 10]}
]
```
