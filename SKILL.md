---
name: url-to-markdown
description: "Convert the main content of a web page (URL) into clean Markdown. Use this skill whenever a URL, web page, or online article should be turned into a Markdown file — handles login-protected pages, tables, code blocks, LaTeX formulas, Mermaid diagrams, and SVG."
---

# url-to-markdown

Opens a web page (handling login walls) and converts its main content into clean Markdown. Special elements are dispatched by type: take the text form when available (LaTeX formulas, Mermaid sources, code blocks), vectors next (SVG exported directly / rebuilt by the LLM), pixel screenshots as the fallback.

## When to use

- Convert the body of a single URL into a Markdown file

## Working principles

- Unless explicitly requested or required by the flow, **do not read the scripts' artifacts or their contents**; just confirm the command ran and the artifacts exist
- You own the semantic work of "step 2" and "step 4": when you can invoke subagents, **prefer delegating the task to a subagent**

## Core parameters

- `<url>`: the full URL given by the user; required by every CLI

> The following parameters are emitted by step 1 and used globally
- `<skill-root>`: the directory containing this skill's SKILL.md (**absolute path**)
- `<url-name>`: the working directory name for the current URL. **Pages whose dominant content lives in an iframe get the special name `redirected_<original>`** (the pipeline has already redirected to the frame's real URL)
- `<url-working-path>`: the current URL's working directory `<skill-root>/working/<url-name>`; all subsequent artifacts are stored under it

Skill directory layout:

```
SKILL.md                 # The skill's main file
script/                  # Scripts
references/              # Task guides for steps 2/4 (progressive disclosure)
package.json

working/                 # Working directory
  cookies/               # Shared cookie storage for every URL visited; created by step 1
  <url-name>/            # The current URL's working directory `<skill-root>/working/<url-name>`
  redirected_<url-name>/ # Working directory for iframe-redirected pages (contains the redirect_to.yaml marker)
    assets/
      images/
      trans/
    1_snapshot.html
    ...
    5_markdown.md
```

## Operation manual (steps 0-5)

### Step 0 · Initialize the environment

```bash
bash <skill-root>/script/init.sh
```

| stdout.status | Action |
|---|---|
| `ok` | Environment ready; proceed to step 1 |
| `error` | **Abort the whole flow** and report `stdout.reason` to the user |

Pure environment self-check (node/pnpm/chromium/fonts). **stdout.status=ok structure example**
```json
{ "status": "ok", "skill-root": "/root/path/to/skill", "node": "20.x", "pm": "pnpm", "chromium": true }
```

### Step 1 · Snapshot download + structural cleaning

```bash
node <skill-root>/script/snapshot.mjs --url <url> [--timeout 300000] [--scroll-rounds 60] [--table-engine self|turndown]
```

One command performs the page fetch and structural cleaning: **the human gate** (login detection / CAPTCHA & slider detection / thin-content fallback — opens a browser viewer for manual login, manual verification, or page-state confirmation when needed, then loops back to re-check automatically once resolved; the viewer's timeout only starts counting once you open it) → scroll loading → redirect handling (dominant-content iframes automatically jump to the real URL; the target page goes through the login & captcha gate as well) → virtual-list detection → snapshot capture + structural cleaning (tables/code blocks precomputed into markdown).

Optional parameters:
- `--table-engine self|turndown` (or `U2M_TABLE_ENGINE`, default `self`): the table-placeholder conversion engine
- `--from-snapshot`: skip fetching and clean the existing `1_snapshot.html` in the working directory directly (no network access)

Artifacts (do not read their contents on your own once generated):
```
<url-working-path>/
  1_snapshot.html               # Full-fidelity snapshot
  1_clean_snapshot.html         # Structural view (step 2 input)
  1_clean_style_snapshot.html   # Styled version (step 3 input)
  1_long_text.json              # Long-text placeholder original-text mapping
  1_tables.json / 1_code.json   # Table/code-block precomputation
```

| stdout.status | Action |
|---|---|
| `ok` | Report stdout to the user and proceed to step 2; take `<url-name>`/`<url-working-path>` from this stdout line (redirected pages carry the special name); the `redirect` field is informational only (later steps still use the original `<url>`) |
| `error` (reason=`virtual_list`) | Tell the user "this page is a virtual list that renders only part of the content, so it cannot be converted to Markdown in full", **abort** |
| `error` (reason=`login_timeout`/`login_aborted`) | Ask the user whether to retry the login; if yes, run this command again |
| `error` (reason=`captcha_timeout`/`captcha_aborted`) | The human-verification viewer timed out or was closed: ask the user whether they are ready to complete the verification, then run this command again (solved sites leave a clearance cookie behind, so a rerun often passes straight through) |
| `error` (reason=`gate_aborted`/`gate_timeout`) | The page body is nearly empty (suspected unrecognized verification page / access block — or it may genuinely be an empty page) and the manual-confirmation viewer was abandoned: ask the user whether the URL really has content; on a retry the user can click "⏭️ Continue Anyway" in the viewer (the site will be remembered and not asked again) |
| `error` (reason=`http_404`) | The target page does not exist (404 with no body): tell the user to check the URL, **do not retry** |
| `error` (reason=`gate_loop_limit`) | The site keeps raising new gates (still unstable after 3 manual interventions): tell the user this URL cannot be fetched automatically; suggest giving up or another capture method |
| `error` (other) | Report `stdout.reason` to the user and abort; if `1_snapshot.html` is already on disk, retry with `--from-snapshot` to skip re-fetching |

**stdout.status=ok structure example**
```json
{
  "status": "ok",
  "skill-root": "/root/path/to/skill",
  "url-name": "redirected_www.example.com_article__ai-article_skill",
  "url-working-path": "/root/path/to/skill/working/redirected_www.example.com_article__ai-article_skill",
  "redirect": { "to": "https://www.example.com/article/skill.html" },
  "loginSkippedByMemory": null
}
```

### Step 2 · You handle key-ID identification

**When subagents are available, prefer delegating this task to one**

#### Task (prompt)

Before dispatching, replace `<skill-root>` and `<url-working-path>` in the prompt with the corresponding fields of step 1's stdout:

> You are a web DOM analysis expert. Following the guide, read the HTML file and produce structured JSON.
>
> **Task**
>
> 1. Read the task guide: `<skill-root>/references/analyze_html_guide.md`
> 2. Read and analyze in one pass: `<url-working-path>/1_clean_snapshot.html`
> 3. After analyzing, write in one pass: `<url-working-path>/2_key_ids.json`
>
> **Principles**
> - Do not read any other files; they are irrelevant to you
> - During the task you may only use the "Read/Write/Edit" tools
> - After writing the JSON, do not write a summary report; just output `Task complete`

#### Follow-up

Once the artifact `<url-working-path>/2_key_ids.json` exists, proceed to step 3

### Step 3 · Render the article view with a script

```bash
node <skill-root>/script/render_article.mjs --url <url>
```

Renders the article view from the styled snapshot using the key IDs (prune DOM → inline styles → extract & slim).

Artifact: `<url-working-path>/3_article.html`; when it exceeds 60KB, chunks `3_article_chunk_X_of_N.html` are also produced (do not read the artifacts' contents yourself — just confirm they exist)

| stdout.status | Action |
|---|---|
| `ok` | Report stdout to the user and proceed to step 4 — when `chunks.split=true`, step 4 dispatches subagents in parallel per `chunks.files`; when `false`, a single subagent as usual |
| `error` | Report `stdout.reason` to the user and abort |

**stdout.status=ok structure example**
```json
{
  "status": "ok",
  "chunks": { "split": true, "count": 8, "files": ["/path/3_article_chunk_1_of_8.html"] }
}
```

### Step 4 · You handle markdown skeleton generation

> **When subagents are available, prefer delegating this task to one**

#### Not chunked (step 3 stdout `chunks.split=false`)

A single subagent, with the task prompt (before dispatching, replace `<skill-root>` and `<url-working-path>` in it with the corresponding fields of step 1's stdout):

> You are a markdown skeleton generation expert. Following the guide, read the HTML article view and produce structured JSON.
>
> **Task**
>
> 1. Read the task guide: `<skill-root>/references/markdown_skeleton_guide.md`
> 2. Read and analyze in one pass: `<url-working-path>/3_article.html`
> 3. After analyzing, write in one pass: `<url-working-path>/4_skeleton.json`
>
> **Principles**
> - Do not read any other files; they are irrelevant to you
> - During the task you may only use the "Read/Write/Edit" tools
> - After writing the JSON, do not write a summary report; just output `Task complete`

#### Chunked (step 3 stdout `chunks.split=true`)

**Dispatch `chunks.count` subagents in parallel in a single message**, each subagent's task prompt tailored to its own chunk file (X is the chunk number, N the total count; before dispatching, replace `<skill-root>` and `<url-working-path>` in it with the corresponding fields of step 1's stdout):

> You are a markdown skeleton generation expert. Following the guide, read the HTML article view and produce structured JSON.
>
> **Task**
>
> 1. Read the task guide: `<skill-root>/references/markdown_skeleton_guide.md`
> 2. Read and analyze in one pass: `<url-working-path>/3_article_chunk_X_of_N.html`
> 3. After analyzing, write in one pass: `<url-working-path>/4_skeleton_chunk_X_of_N.json`
>
> **Principles**
> - Do not read any other files; they are irrelevant to you
> - During the task you may only use the "Read/Write/Edit" tools
> - After writing the JSON, do not write a summary report; just output `Task complete`

#### Follow-up

- Not chunked: once the artifact `<url-working-path>/4_skeleton.json` exists, proceed to step 5
- Chunked: proceed to step 5 only after **all `chunks.count` chunk files exist** (step 5 detects and merges the chunks automatically); if individual chunks fail or are missing, redispatch that chunk once; if it fails again, report the missing list to the user and abort

### Step 5 · Restore placeholders + download images + screenshots + generate Markdown with a script (final step)

```bash
node <skill-root>/script/render_markdown.mjs --url <url>
```

Artifact: `<url-working-path>/5_markdown.md` (the final product; see `markdownPath` in stdout — do not read the artifact's contents yourself, just confirm it exists)

| stdout.status | Action |
|---|---|
| `ok` | Report stdout to the user; **all steps are done** (`skipped: "no_trans2img"` is informational only, no action needed) |
| `error` | Report `stdout.reason` to the user and abort |

**stdout.status=ok structure example**
```json
{ "status": "ok", "markdownPath": "/path/5_markdown.md" }
```

## Common error handling

| Symptom | Action |
|---|---|
| `init.sh` reports `未找到 pnpm/yarn/npm` (no pnpm/yarn/npm found) | Ask the user to install any one package manager, then retry step 0 |
| `init.sh` (Linux) reports fontconfig/font installation failure (needs root/sudo) | Step 0's auto-repair failed (no root, or no package manager): ask the user to manually install fontconfig and fonts as root (Western fonts e.g. liberation, CJK fonts e.g. noto-cjk), then retry step 0; without them, chromium FATAL-crashes when rendering any page containing text |
| `snapshot` decides the user is logged in but the page still shows a login wall | Ask the user to manually delete `working/cookies/storage_state.json`, then rerun step 1 |
| `snapshot` opens the login viewer for a page that needs no login | The user clicks "⏭️ Skip Login" in the viewer and confirms to continue (this site will not prompt again; the emit reports it via `loginSkippedByMemory`); to reset the decision, delete the site's entry in `working/cookies/login_decisions_skips.json` and rerun step 1 (the same file also stores "Continue anyway" decisions for thin content as `content_sparse`) |
| `snapshot` opens the human-verification viewer (slider / click challenge) | The viewer relays mouse dragging and keyboard — drag the slider or solve the challenge right in the canvas, then click "✅ Verification Done"; this viewer has no skip button (skipping would only capture the challenge page), and closing it reports `captcha_aborted` |
| `snapshot` keeps reopening the verification viewer even after the user solved it | The site's anti-bot may reject headless-browser traces (a known boundary — even a correct human trajectory can be rejected): rerun once; if it keeps failing, suggest giving up on the site |
| `snapshot` reports `virtual_list` but the user is sure it is an ordinary long page | The site may actively prune off-screen DOM (isomorphic to a virtual list — the output is likewise just a partial window); this is a known boundary — suggest another capture method |
| Page load reports `net::ERR_TUNNEL_CONNECTION_FAILED` / `ERR_PROXY_CONNECTION_FAILED` | The local system proxy is unavailable or rejects the target site: set `U2M_PROXY=direct` to bypass the system proxy, or `U2M_PROXY=http://<host>:<port>` to pin a working proxy, then rerun |
| `snapshot --from-snapshot` reports the snapshot missing | Drop `--from-snapshot` and run this command again (re-fetch the snapshot) |
| `render_article` reports the styled snapshot missing | Run step 1 first to generate `1_clean_style_snapshot.html` |
| `render_markdown` reports a code entry's value should be a `{lang, content}` object | Step 4 referenced an unresolved code placeholder (a k that is absent or failed in `1_code.json`): inspect the code entries of `4_skeleton.json` — placeholder blocks must use `{"code": "{{CODE_k}}"}` references and live code blocks are converted by the LLM itself (see the skeleton guide) — fix and rerun step 5 |
| `render_article` / `render_markdown` report key_ids missing | Run step 2 first to generate `2_key_ids.json` |
