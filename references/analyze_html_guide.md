# Task

This is a snapshot of an **article page**. Read the DOM structure of `1_clean_snapshot.html` (element hierarchy, tag types, semantic classes) together with the **text-volume** distribution, and locate the `data-idx` (**hereafter "ID"**) of the page's four kinds of key article elements:

1. **Title block** (`titleId`): the ID of the element holding the article's main title. Usually the highest-level `<h1>`–`<h3>` inside the article body scope (see "Principles / Constraints"), or a heading-like container positioned outside or at the top of the paragraph flow; **mark it here whether it sits inside the paragraph flow or not** — if the title element itself falls inside the flow, it **may simultaneously keep its original position in `paragraphIds`**; `null` when there is no main title or it cannot be determined

2. **Description blocks** (`descriptionIds`): the set of IDs of elements holding descriptive metadata — author, date, summary, subtitle, opening remarks; **mark them here whether inside or outside the paragraph flow** — those falling inside the flow may likewise keep their original position in `paragraphIds`; may be an empty array

3. **Paragraph flow** (`paragraphIds`): the **nested sequence of the article's paragraph blocks**, the whole tree in document order — **a scalar is a paragraph-block ID; an array is the block list of one sub-flow**

  - Common paragraph-block elements (the list is guidance, not a whitelist):
    - Paragraphs: `<p>`
    - Headings: `<h1>`–`<h6>`
    - Preformatted / code blocks: `<pre>` (content folded into a `{{CODE_k|x_lines}}` placeholder; k is the document-order index, x = number of code lines)
    - Table blocks: `<table>` (content folded into a `{{TABLE_k|y×x}}` placeholder; k is the document-order index, y = row count, x = column count)
    - Composite units: `<figure>` (image + `<figcaption>`)
    - Lists: `<ul>`, `<ol>`
    - Definition lists `<dl>` (`<dt>`/`<dd>` term pairs, Q&A, metadata pairs)
    - Quotation blocks `<blockquote>`
    - Collapsible blocks: `<details>`, collapsed trees carrying the `hidden` attribute (FAQ / accordion / collapsible / expand-collapse blocks)
    - Toggle buttons: `<button>` (row-level controls of accordion / collapsible items)
    - Structural blocks: `<section>`, `<aside>`, `<header>`
    - Media blocks: `<img>`, `<picture>`
    - Diagram / chart containers (visual modules of nested `<div>`s), cards / callouts — marked whole as one block, never split internally (inner text may be folded into a `{{VIEW_TEXT|n_chars}}` placeholder, see "Structure notes")

  - A paragraph block is a **complete subtree** and is never split internally

  - **Inline elements and separators are usually not paragraph-level blocks**: `<span>`, `<a>`, `<strong>`, `<b>`, `<em>`, `<i>`, inline `<code>`, `<br>` and other inline elements, plus the `<hr>` separator; **except when they are direct children of the paragraph flow**

  - **A paragraph block is usually not a fixed element** but a combination of wrapper container + semantic content (see Structure notes), with nesting chains like `<div> > <h1>` (container wrapping a heading) / `<div> > <table>` (container wrapping a table) / `<section> > <div> > <pre>` (multi-level container wrapping a code block)

  - **The main paragraph flow and sub-flows are judged by different logic** — the main paragraph flow is the outermost content sequence of the article body; a sub-flow is a sequence nested inside it. Judging them separately is more general:

    | | Main paragraph flow | Sub-flow |
    |---|---|---|
    | Heading block | Not excluded: counts toward size, may stay in place | If the first direct child is a heading block: excluded from the count, placed as the leading scalar of the flow |
    | Anchor / sub-flow | Not required | Required: \|R\|≥2 must contain an anchor or an already-formed sub-flow; \|R\|=1 must be a sub-flow with a heading block |
    | Minimum size | ≥2 content child blocks (title/description count, noise does not) | After excluding heading block/noise, \|R\|≥2, or heading block + a single sub-flow |

  - **Main paragraph flow (top level)** — the outermost content-sequence container of the article body (identified semantically within the "article body scope": it carries the body proper and excludes page-level wrappers such as page header/navigation/footer/cover; a page-level wrapper does not become a flow merely by containing one):
    - **No heading-block exclusion** — the article's main title is `titleId` and hero/metadata are `descriptionIds`; both **may keep their original position in the main paragraph flow** (overlapping with `titleId`/`descriptionIds`); they need not be pulled out for disjointness. Non-primary headings appearing inside the main flow (e.g. flat section `<h2>`s) are ordinary scalar blocks and get no special treatment
    - **No anchor block required** — direct children may all be parallel, non-nested sub-flows, e.g. `[[1,[2]], [3,[4]]]`; as long as there are ≥2 content child blocks (paragraph blocks / sub-flows; **title/description blocks count toward size** and may simultaneously stay in place in `paragraphIds`; noise does not count), it forms a flow. If only one content child remains after removing title/description/noise, that container is a **transparent wrapper** — descend into it (see "One flow, one dimension")
    - Blocks are ordered by document order; a sub-flow occupies one array slot and its container ID never enters the JSON

  - **Sub-flows (nested)** — content sequences nested inside the main paragraph flow or a higher-level sub-flow:
    - If the first direct child is a **heading block** (subtree contains `<h1>`–`<h6>`; bare headings and `<header>`/heading-like containers all qualify), exclude it from the size count and place it as the leading scalar of the sub-flow; then remove noise children and let the remainder be R:
      1. **|R| ≥ 2** and R contains at least one anchor block or an already-formed sub-flow → it forms a flow; or
      2. **|R| = 1** and that child is an already-formed sub-flow (which must carry a heading block — a "titled flow"; a lone sub-flow without a heading block is a transparent wrapper, see "One flow, one dimension") → it forms a flow
    - **An anchor or sub-flow is required** — this distinguishes a content sequence from a single composite monolith; when not satisfied, the whole subtree is one block of the parent flow (heading block + a single non-flow block is the typical "titled monolith" and does not form a flow)
    - When it forms a flow: the heading block (if any) is the leading scalar; a sub-flow occupies one array slot and its container ID never enters the JSON. Without a heading block the first child is not excluded and goes straight into R (e.g. a closing section `[label, [body…], ul]` — the leading label is not a heading, is not excluded, and the flow forms via ≥2 + anchor)

  - An **anchor block** is an unmistakable, obvious paragraph block: `<p>` / `<h1>`–`<h6>` / `<table>` / `<pre>` / `<figure>` / `<ul>` / `<ol>` / `<block><img/></block>` / `<blockquote>` / `<button>` / `<dl>` / `<details>` / elements with the hidden attribute. Common property: **content-semantic tag ∧ renders on its own line by default** — the tag itself announces "I am a paragraph / heading / list / table / quote / code block / image block", confirmable without looking at styles (the snapshot carries no styles; line-ness comes from tag semantics). The list is guidance; this property is the criterion. Structural container tags like `<div>`/`<section>`/`<aside>` are also block-level by default, but what they hold is decided by content — **they can serve as blocks, but never as anchors**. **Exception — single-level anchor pass-through**: when a direct child's subtree contains **exactly one** anchor block (`<div><p>…</p></div>`, `<div><table>…</table></div>`), the wrapper is judged as the anchor — real pages are almost entirely of this wrapped form; anchor-ness is determined by content, not by the shell. Not applicable when the subtree holds multiple blocks. `<button>` is inline-block by default, but as a direct child of the paragraph flow it is the row-level toggle of an accordion/collapsible
    - When a container's direct children are all `<div>`s yet the text/structure clearly reads as a paragraph sequence (e.g. prose containers, repeated same-class paragraph instances), it may be judged a flow semantically — the anchor is a strong default signal, not a hard gate; stay careful, though, to avoid misjudging deeply nested divs as flows

  - **Priority of collapsible blocks / visual modules**: `<details>`, div-style collapsible blocks (button title + content container, functionally identical to `<details>` regardless of whether the content is visible in the snapshot), collapsed trees carrying the `hidden` attribute, and multi-level div visual modules such as diagrams/charts/cards/callouts are all marked whole as **scalar anchor blocks, never split internally** — even when they contain anchor elements like `<p>`/`<h4>`/`<table>`, they **do not trigger sub-flow splitting** (the sub-flow criteria do not penetrate these semantic shells); `<h4>`/`<h5>` inside a diagram/chart are chart annotations, not heading blocks. This priority overrides the div structural sub-flow criteria

  - **One flow, one dimension**: arrays correspond one-to-one with paragraph flows; non-flow wrapper layers between flows (intermediate containers that, after noise removal, hold just one sub-flow and no heading block) are **transparent and occupy no dimension** — their sub-flow's array merges directly into the parent level

  - Nesting example `paragraphIds: [1, 2, [3, 4, [5, 6]], 7]`: `1/2/7` are in the outer paragraph flow, `3/4` in a "sub-flow", `5/6` in a deeper "sub-flow" (a single-element sub-flow without a heading block does not form — insufficient size, see sub-flow rules). The top level is simply the document-order sequence — loose content blocks outside the flow (siblings of the flow) are likewise top-level scalars, with no distinction drawn; if the page has no single container and the body lies flat directly under `<body>`, the top level is the document-order sequence of body's direct children (body itself never enters the JSON)

4. **Noise elements** (`dumpIds`): the ID set of non-article content elements **inside the paragraph flow** that are not selected into `paragraphIds`; noise outside the flow **needs no marking**
  - Menus, navigation, table of contents (TOC), breadcrumbs, footer links, related-post recommendations, comment lists, share bars, ads, popups, forms
  - You **must be certain** the element is not article content; when uncertain, do not include it. Noise elements may internally contain `<ul>` (nav/TOC/recommendations) / `<p>` / `<h>` and other paragraph elements — **the semantic gate is independent of the flow-formation criteria**: a nav/TOC can fully satisfy the structural flow conditions and still be noise semantically
  - dumpIds should prefer the highest parent/ancestor element inside the flow over a pile of descendants — **ceiling: no dump may be an ancestor of any key (`titleId`/`descriptionIds`/`paragraphIds` block)**; take the highest ancestor whose subtree contains no key element
  - Noise inside the subtree of an already-marked block (paragraph block / title / description) needs no separate marking — blocks are marked whole and never split internally

### "Paragraph flow" examples

> **Locate `titleId` (`<h1>`–`<h3>`) first**; `descriptionIds` always come after it; `paragraphIds` start at the interval start (see "Document-order interval" below)

#### Main paragraph flow (P)

```html

<div data-idx="A">
  <h1 data-idx="A1">Article title</h1>
</div>

<div data-idx="B">
  <p data-idx="B1">Article description</p>
</div>

<!-- main paragraph flow [P] + anchor blocks [P1, P2] + sub-flow [P3] -->
<article data-idx="P">
  <h2 data-idx="P1">…</h2>
  <p data-idx="P2">…</p>
  <section data-idx="P3">
    <header data-idx="P4"><h2 data-idx="x">…</h2></header>
    <div data-idx="P5"><pre data-idx="x">…</pre></div>
    <p data-idx="P6">…</p>
  </section>
</article>
<!-- title block: A1; description blocks: [B1] -->
<!-- main paragraph flow: [P1, P2, [P4, P5, …]] (P/P3 are mere containers, never in the JSON themselves) -->
```

#### Main paragraph flow (K) containing title/description

```html
<!-- main paragraph flow [K] + title/description (count toward the ≥2 size) -->
<article data-idx="K">
  <!-- when titleId/descriptionIds sit inside the main paragraph flow: first `paragraphIds` block [A] < titleId/descriptionIds (nested in the first block's subtree) < subsequent blocks; the first block is the interval start -->
  <!-- the paragraph block is always the flow's direct child [A], not its inner [A1, A2] -->
  <div data-idx="A">
    <h1 data-idx="A1">Article title</h1>
    <p data-idx="A2">Article description</p>
  </div>
  <section data-idx="M1">
    <div data-idx="M2"><h2 data-idx="x">…</h2></div>
    <div data-idx="M3"><p data-idx="x"></p></div>
    <div data-idx="M4"><ol data-idx="x">…</ol></div>
  </section>
  <section data-idx="M5">
    <header data-idx="M6"><h2 data-idx="x">…</h2></header>
    <div data-idx="M7"><pre data-idx="x"></pre></div>
    <div data-idx="M8"><p data-idx="x">…</p></div>
  </section>
</article>
<!-- title block: A1; description blocks: [A2] -->
<!-- main paragraph flow: [A, [M2, M3, M4, …], [M6, M7, M8, …]] (K/M1/M5 are mere containers, never in the JSON themselves); the title/description blocks may also stay in place in paragraphIds -->
```

#### Main paragraph flow (M) containing parallel sub-flows (M1 + M7(M5))

```html

<div data-idx="A">
  <h1 data-idx="A1">Article title</h1>
</div>

<div data-idx="B">
  <p data-idx="B1">Article description</p>
</div>

<!-- parallel sub-flows of the main paragraph flow: direct children are all sub-flows, no anchor → the main paragraph flow requires no anchor and still forms -->
<article data-idx="M">
  <section data-idx="M1">
    <div data-idx="M2"><h2 data-idx="x">…</h2></div>
    <div data-idx="M3"><p data-idx="x">…</p></div>
    <div data-idx="M4"><ol data-idx="x">…</ol></div>
  </section>
  <!-- M5 is a titled flow (rule 2: heading block M6 + single sub-flow M7), unlike M1 (rule 1: after excluding heading block M2, R = M3/M4 ≥2, anchor pass-through holds); M7 is a sub-flow occupying one array slot (container ID never in the JSON) → the M5 array = [M6, [M8, M9, M10]] -->
  <section data-idx="M5">
    <div data-idx="M6"><h2 data-idx="x">…</h2></div>
    <div data-idx="M7">
      <div data-idx="M8"><p data-idx="x">…</p></div>
      <div data-idx="M9"><pre data-idx="x">…</pre></div>
      <div data-idx="M10"><table data-idx="x">…</table></div>
    </div>
  </section>
</article>
<!-- title block: A1; description blocks: [B1] -->
<!-- main paragraph flow: [[M2, M3, M4, …], [M6, [M8, M9, …]]] (M/M1/M5 are mere containers, never in the JSON themselves) -->
```

#### Three sub-flow forms (A/B/C)

```html
<!-- form A: bare heading + flat body (no body wrapper) — the first h2 is the heading block and the leading scalar; the body has ≥2 anchors → forms a flow -->
<div data-idx="A">
  <h2 data-idx="A1">Section heading</h2>
  <p data-idx="A2">…</p>
  <p data-idx="A3">…</p>
</div>
<!-- in the parent flow: [A1, A2, A3] -->
```

```html
<!-- form B: div + body sub-flow -->
<!-- [B1] heading-block scalar; [B3] is a sub-flow → occupies an array slot; B/B3 themselves are mere containers, never in the JSON -->
<section data-idx="B">
  <div data-idx="B1"><span>01</span><h2 data-idx="B2">Section heading</h2></div>
  <div data-idx="B3" class="section__body">
    <p data-idx="B4">…</p>
    <p data-idx="B5">…</p>
    <div data-idx="B6" class="diagram">…multi-level div visual module, one whole block, never split…</div>
  </div>
</section>
<!-- in the parent flow: [B1, [B4, B5, B6]] -->
```

```html
<!-- form C: heading block + a single "non-flow block / description block" → does not form a flow; the whole subtree is one block of the parent flow -->
<section data-idx="C">
  <header data-idx="C1"><span>02</span><h2 data-idx="C2">Section heading</h2></header>
  <p data-idx="C3">…</p>
</section>
<!-- in the parent flow: the scalar C (C1/C2/C3 never enter the JSON; the whole subtree is one block) -->
```

## Principles / Constraints

- The paragraph flow (`paragraphIds`) **must exclude** noise elements; collect only the article's core body content

- Four-key constraints — `titleId`/`descriptionIds` may **overlap** with `paragraphIds` (title/description inside the flow keep their in-flow position); all other combinations (`titleId`∩`descriptionIds`, any key ∩ `dumpIds`) are mutually disjoint, and no key may list the same ID twice

- Never select `<body>` or `<html>` — their IDs are meaningless

- **Article body scope** (the domain where the flow-formation criteria apply) = the smallest content container carrying the article title/description/body (often `<article>`, `<main>`, or a container whose class contains article/content/post/prose); the site-level header (site name/navigation), sidebars, footers, covers and other page-level wrappers lie outside it, and none of them becomes a flow merely by containing one. A site-level `<h1>` (site name/logo in the page header) is not the article's main title — the article main title lives inside the body scope and may be an `<h2>`/`<h3>`

- **Document-order interval (output principle)**: the article body is one contiguous interval in the document, fixed in the order `titleId` → `descriptionIds` → `paragraphIds` — `titleId` ≤ all `descriptionIds`. The title/description may sit outside the flow (`descriptionIds` < the minimum of `paragraphIds`; title/description before the flow), or inside the flow's first block (minimum of `paragraphIds` ≤ `titleId` — the title/description is the first `paragraphIds` block itself, or nested in the first block's subtree per "take the direct child"; the first block is then the interval start). **Interval start = min(`titleId`, minimum of `paragraphIds`)**. From this:
  - Elements **before the interval start** that are in no key (cover, page header, site navigation, eyebrow / decorative tagline above the hero title) are **external** — do not mark them (noise outside the flow needs no marking)
  - "Summary / roadmap / key points" cards falling **inside the `paragraphIds` interval** (after the lead-in/body) belong to `paragraphIds` as scalar blocks, **not to `descriptionIds`** — they are already body content, not front matter
  - This interval is the boundary criterion for the article body: non-article structures outside it (footer, related posts, comments, floating widgets, …) are external across the board — do not mark
  - **Tip**: locate `titleId` (`<h1>`–`<h3>`) first; `descriptionIds` always come after it; `paragraphIds` start at the interval start — outside the flow the start is `titleId`; inside the flow's first block the start is the first `paragraphIds` block (≤ `titleId`)

## Structure notes (`1_clean_snapshot.html`)

- `data-idx` is a **document-order increasing integer** over the elements inside body (1, 2, 3, …): a larger number means a later position and the values compare directly — all positional reasoning such as the "document-order interval" relies on this

- Link and image elements **carry no URLs** (href/src emptied; link text and alt remain)

- `{{LONG_TEXT|n_chars}}` / `{{LONG_TEXT|n_words}}` are long-text placeholders (the clean version carries **no index** — indices exist only in the styled version's restore chain and are irrelevant to reading). **Whole-run folding is the norm**: a maximal pure inline run above the threshold (>16 CJK characters / >12 words — a paragraph's entire content mixing text with inline elements like strong/em/code/a) folds into a single placeholder; loose long text nodes sandwiched between block-level children are likewise folded; short text (≤16 CJK characters / ≤12 words) stays verbatim. Placeholder distribution is a reading clue — the position and volume of paragraphs/headings/buttons remain visible; `<title>` keeps its original text (not folded)

- `{{CODE_k|x_lines}}` is a code-block content placeholder; k = the document-order index (from 1, skipping `[hidden]` pre), x = the code's line count (counted on the pre-fold original's line structure); `data-language` sits on the pre attribute. ok and failed blocks are both placeholders in the clean version (clean always folds); mark them into paragraphIds exactly like table placeholders; the original text of a successful code block has been precomputed into `1_code.json` by step 1 and is restored by step 5

- `{{TABLE_k|y×x}}`: whole-table placeholder; k = the document-order index (from 1, skipping `[hidden]` tables), y = row count (number of `<tr>`), x = column count (max over rows of the sum of colspans, i.e. the grid width). The scale is a signal for reading the table — a big table (e.g. the `30×` class) is very likely a core data carrier. The GFM markdown of a successful table has been precomputed into `1_tables.json` by step 1 and is restored by step 5; step 2 only needs to mark its `data-idx` into paragraphIds

- `{{HIDDEN_TAG|n_chars;n_a/n_div/…}}` marks an element carrying the `hidden` attribute whose subtree was folded; the token reports the real text volume and tag composition (counts descending), signaling a wholly folded block. Judge a hidden element by its content semantics: article body (FAQ/appendix/expand-collapse) → a paragraph block (and an anchor); page furniture (modal/drawer/mobile nav) → mark `dumpIds` inside the flow, leave unmarked outside. It also covers **CSS-hidden scaffolding at the body boundary** (display:none/visibility:hidden on body's direct descendants and only-child chains) — the reading method is unchanged; CSS-hidden content deep in the body flow (inactive tabs, collapsed FAQ answers) is not folded and its text stays visible
- `{{DIALOG_TAG|n_chars;composition}}` is the folded shell of a `role="dialog"`/`aria-modal` popup (at any depth) — **chrome, never select it into any key**; the shell's data-idx does not need dumpIds either (step 3 prunes whole branches outside the keys)
- `{{OVERLAY_TAG|n_chars;composition}}` is the folded shell of a visible fixed/absolute/sticky overlay on body-boundary only-child chains (login banners / sticky toolbars, …) — **chrome, never select it into any key**

- `{{VIEW_TEXT|n_chars}}` / `{{VIEW_TEXT|n_words}}` are **pure-view-text placeholders**: inside a visual module (diagram / chart / comparison card / rendered formula, …), the maximal subtree holding "only div + inline text elements (span/a/strong/em/code/br/MathML, …) + text", or a p root holding "only text and inline elements", is folded — **the shell element stays**: tag, class, data-idx and aria-label untouched. Even if the module contains long text it is **folded whole and the original text is swallowed by the fold** (`n` is the module's overall text-volume signal). Reading points: ① **the shell's class/aria-label identifies the module** (e.g. `ra-raw`, `katex-html`) and `n` signals the module's text volume; ② when marking paragraphIds, mark **the shell's `data-idx` as one whole block** (visual modules are marked whole, never split internally); the placeholder is not paragraph text — do not mark already-folded descendant ids inside the shell. Subtrees with insufficient text (<8 CJK characters / 6 words) or thin structure (pure div trees with ≤6 inner divs; inline-bearing trees with ≤4 elements) **stay verbatim**; text structures inside links/buttons/headings (h1-h3) and subtrees containing images (img) are not folded either

    Before/after folding (the pre-fold form is illustrative only — what you see in `1_clean_snapshot.html` is the folded form):

    ```html
    <!-- before folding: inside the visual module are div/span + text fragments -->
    <div class="ra-raw" data-idx="90">
      <div data-idx="91">
        <div data-idx="93">
          <div data-idx="95">Health</div>
          <div data-idx="96">1×</div>
        </div>
        <div data-idx="98">95% hit rate</div>
        <div data-idx="99">~1× cost</div>
      </div>
    </div>

    <!-- after folding: the shell stays (class/data-idx still referenceable), the inside collapses into a single placeholder -->
    <div class="ra-raw" data-idx="90">{{VIEW_TEXT|24_chars}}</div>
    ```

    The same folding also appears in: chart axis-tick rows (a row of `0`/`2.5k`/`5k` tick divs), diagram steps (`Step 1` / arrow fragments), KaTeX visual twins (a span tree whose class contains `katex-html` — the HTML rendering copy of a formula; its sibling MathML is the semantic original), and the **p>inline form** — p usually does not nest p and holds only text or inline elements; a pure-inline paragraph with more than 4 inline elements (span/a/code/strong/MathML, …) (styled phrases / dense links / inline-formula runs) folds as a whole:

    ```html
    <!-- before folding: p holds purely inline content (no block tags like div/p/img; inline elements like a/code/strong may interleave) -->
    <p data-idx="2"><span class="k">alpha</span><span class="k">beta</span><span class="k">gamma</span><span class="k">delta</span><span class="k">epsilon zeta</span></p>

    <!-- after folding: the p shell stays -->
    <p data-idx="2">{{VIEW_TEXT|6_words}}</p>
    ```

    Counter-examples not folded: plain-text paragraphs, paragraphs containing img, paragraphs with ≤4 inline elements — normal body paragraphs stay fully visible. The placeholder sits exactly where the module was; it participates in flow/anchor judgment like any ordinary visual module (a div shell can serve as a block, but not as an anchor)

### Example (`1_clean_snapshot.html`):

```html
<html>
<body>
  <div data-idx="1" class="xxx">

    <!-- the page's only title → titleId = 2 -->
    <h1 data-idx="2"><span>Title…</span></h1>
  </div>

  <!-- [3]/[4] are standalone article descriptions → into descriptionIds; being standalone, choosing [3] or [4] makes no real difference -->
  <div data-idx="3">
    <p data-idx="4"><span>This is an article about …</span></p>
  </div>
  <!-- [5], an ancestor of the outermost paragraph-flow container [6], must not be counted into paragraphIds (one extra "[]" layer carries no meaning) -->
  <div data-idx="5" class="xxx">

    <!-- the paragraphIds top level starts from the children of the outermost paragraph-flow container [6]:
         content children [7] (description counts toward size) / [10]/[13]/[14] ≥2, noise [9]/[37] not counted → [6] forms a flow (the main paragraph flow requires no anchor) -->
    <section data-idx="6" class="article main content">
      <!-- [7] is an article description inside the paragraph flow — wherever it sits, it goes into descriptionIds -->
      <!-- the paragraph block is always the flow's direct child [7], not its inner [8]; [7] may also stay in place in paragraphIds -->
      <div data-idx="7">
        <p data-idx="8"><span>Author: xxx</span><span>Name: xxx</span></p>
      </div>

      <!-- noise element [9] inside the paragraph flow → mark dumpIds -->
      <div data-idx="9" class="ad">Ad…</div>

      <!-- a paragraph block is usually not a fixed element but a combination of wrapper container + semantic content -->
      <!-- [10]: first child <h2>[11] is the heading; after excluding it from the count, R is just <pre>[12] (not a flow) → no flow forms (titled monolith) — the whole thing is one block of [6]; take [10], not [11, 12] -->
      <div data-idx="10">
        <h2 data-idx="11">…</h2>
        <pre data-idx="12">{{CODE_k|x_lines}}</pre>
      </div>

      <!-- exception: when an inline element is a direct child of the paragraph flow, treat it as an independent paragraph block -->
      <span data-idx="13">{{LONG_TEXT|n_chars}}</span>

      <!-- a standalone section module under the paragraph flow, containing further "sub-flows" -->
      <!-- [14]: first child [15] is the heading → excluded from the count, placed first in the sub-flow; R = [18]/[31]/[36] ≥2,
           anchor [36] (hidden) → a sub-flow; in [6]'s sequence it occupies one array; [14] itself never appears in the JSON -->
      <section data-idx="14" class="block">
        <!-- standalone paragraph block [15] -->
        <header class="head" data-idx="15">
          <span data-idx="16">01</span>
          <h2 data-idx="17">Section heading</h2>
        </header>

        <!-- [18]: after removing noise [19], only sub-flow [20] remains, no heading → transparent wrapper, occupies no dimension (see "One flow, one dimension") -->
        <section data-idx="18" class="article main content">

          <!-- [19] has no valid content (paragraph/text); it is noise (inside flow [14]) → mark dumpIds -->
          <div data-idx="19"></div>

          <!-- standalone "sub-flow" [20]: first child [21] is the heading, excluded from the count, placed first; R = [23]/[27]/[28] ≥2, anchors <figure>[23]/<p>[27]/<dl>[28] -->
          <div data-idx="20">
            <header class="head" data-idx="21">
              <h2 data-idx="22"><span>01</span>Section heading</h2>
            </header>
            <figure class="table" data-idx="23">
              <figcaption data-idx="24">Table caption</figcaption>
              <div data-idx="25">
                <table data-idx="26">{{TABLE_3|8×4}}</table>
              </div>
            </figure>
            <p data-idx="27"><span>…</span></p>
            <dl data-idx="28">
              <dt data-idx="29">…</dt>
              <dd data-idx="30">…</dd>
            </dl>
          </div>
        </section>

        <!-- [31]: first child header[32] is the heading; after excluding it, R is just <p>[35] (not a flow) → no flow forms (titled monolith) — the whole thing is one paragraph block -->
        <section data-idx="31" class="article main content">
          <header class="head" data-idx="32">
            <span data-idx="33">02</span>
            <h2 data-idx="34">Section heading</h2>
          </header>
          <p data-idx="35"><span>…</span></p>
        </section>

        <!-- a hidden element folded by hidden counts as a paragraph block in the flow (and is the anchor that lets [14] form) -->
        <div data-idx="36" hidden class="expand">{{HIDDEN_TAG|120_chars;3_p}}</div>
      </section>

      <!-- clearly noise like TOC/navigation (contains h/ul/li/p; structurally qualifies as a flow but semantically is navigation) → mark dumpIds -->
      <!-- dumpIds should prefer the highest parent/ancestor [37], not a pile of descendants [38,39,40] -->
      <nav class="toc" data-idx="37">
        <p data-idx="38">01 xxx</p>
        <ul data-idx="39">
          <li data-idx="40">01 xxx</li>
          <li data-idx="41">02 xxx</li>
          <li data-idx="42">03 xxx</li>
        </ul>
        <p data-idx="43">01 xxx</p>
      </nav>
    </section>
  </div>

  <!-- clearly noise, but outside the paragraph flow — no marking needed -->
  <div data-idx="44" class="dialog">
    <h2 data-idx="45">…</h2>
    <p data-idx="46">…</p>
    <section data-idx="47">…</section>
    <div data-idx="48" class="button">confirm</div>
  </div>
</body>
</html>
```

## Output requirements for `2_key_ids.json`

**JSON contract**: write out all four keys; `titleId` is a positive integer, or `null` when there is no main title or it cannot be determined; `descriptionIds`/`dumpIds` may be empty arrays; `paragraphIds` is **required and non-empty** (mark at least one paragraph block); array members are positive integers (blocks) or nested arrays (sub-flows), each array written in document order

Full JSON structure:

```json
{
  "titleId": 2,
  "descriptionIds": [3, 7],
  "paragraphIds": [10, 13, [15, [21, 23, 27, 28], 31, 36]],
  "dumpIds": [9, 19, 37]
}
```

Minimal form when there is no title / no description / no in-flow noise:

```json
{
  "titleId": null,
  "descriptionIds": [],
  "paragraphIds": [5, 6, [8, 9]],
  "dumpIds": []
}
```
