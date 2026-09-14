# url to markdown

Opens a web page (handling login walls) and converts its main content into clean Markdown. Special elements are dispatched by type: text form first whenever available (LaTeX formulas, Mermaid source, code blocks), vector next (SVG exported directly / rebuilt by the LLM), pixel screenshots as the fallback.

See [SKILL.md](SKILL.md) for the operations manual (step 0-5 decision tables, error handling); see [CLAUDE.md](CLAUDE.md) for development conventions, architecture, and technical details aimed at Claude Code (the single source of truth).

## Why build this

Traditional script-based converters (`markdown-it / turndown`) all suffer from these problems:

- Cannot accurately identify heading levels (`h1-h5`) or button-style subheadings
- Cannot detect hidden sections and paragraphs
- Cannot correctly handle complex UI modules: flowcharts, interactive controls

## What this SKILL can do

- Accurately identifies headings of all levels, sections, and paragraphs
- Recognizes hidden/collapsed content
- Supports LLM semantic recognition and conversion for tables and code blocks that scripts cannot convert
- Accurately identifies complex UI modules and converts them into images; supports screenshots of scrollable content
- Opens a browser window for human-in-the-loop actions such as "scan QR code" / "enter username & password" / "clear captcha"
- Supports automatic redirection into pages embedded in iframes

## What this SKILL cannot do yet

- Documents built on virtual lists (Virtual-List), such as Feishu/Lark and DingTalk docs

## Design philosophy

- Every HTML article/document is essentially a long list of "heading + N paragraphs"; combine physical splitting with LLM semantic processing
- Compress the DOM input to the extreme before the LLM semantic-recognition step: web pages shrink from 1.6MB to 30KB, a compression ratio above 98%; keep the output as small as possible too — the LLM only emits structured JSON
- Clean the noise with scripts first (tag attributes, non-semantic class names, long text, large tables, long code blocks), then hand the semantic content to the LLM
- Long text, tables, and code blocks are replaced with short placeholders and restored after LLM processing — saves input tokens and prevents hallucination driven by page content
- Well-formed `table` tables and `pre>code` blocks are converted directly by scripts to lower LLM conversion cost; the LLM acts as the fallback when conversion fails
- For large complex div modules, a "screenshot boundary chain" design supports capturing scrollable modules

## Tech stack

- **Playwright** (chromium) — headless capture, CDP Screencast login relay, 2x element screenshots
- **juice** — CSS cascade engine, inlines `<style>` rules into element style attributes
- **ws** — WebSocket relay for the Screencast viewer
- Semantic dispatch (step 2 key-ID recognition / step 4 markdown skeleton) is performed by the LLM agent following the SKILL.md manual, with no reliance on readability / turndown-style conversion libraries

## Environment requirements

- Node ≥ 20 (`init.sh` can install the right version via nvm)
- Linux / macOS
- Package manager priority pnpm > yarn > npm (falls back down the list, does not install one itself)
- Playwright chromium (`init.sh` detects and installs it)

## Project structure

```text
SKILL.md                 # Skill main file (step 0-5 operations manual)
CLAUDE.md                # Development conventions for Claude Code (single source of truth for technical details)
README.md                # This overview (English)
README.zh-CN.md          # This overview (Chinese)
script/                  # CLI scripts
  lib/                   # Shared modules (contract / env / browser…) and page scripts page-*.js
test/                    # Unit / integration tests + fixtures + smoke checklist
docs/                    # Design documents and implementation plans
package.json
pnpm-lock.yaml

working/                 # Runtime working directory (gitignored, only the skeleton is kept)
  cookies/               # Shared login-state storage for all visited URLs
  <url-path>/            # All step 1-5 artifacts for that URL (final artifact 5_markdown.md)
  redirected_<url-path>/ # Dedicated directory for iframe-redirected pages (contains the redirect_to.yaml marker)
```

## Core pipeline (steps 0-5)

Steps 0, 1, 3, and 5 only run scripts and branch on the `status` field in stdout; steps 2 and 4 are semantic processing done by the agent (LLM).

| Step | Executor | Command | Artifacts |
|---|---|---|---|
| 0 Environment init | script | `bash script/init.sh` | Environment ready (node/pnpm/chromium/fonts; pure environment self-check, no arguments) |
| 1 Snapshot download + structural cleaning | script | `node script/snapshot.mjs --url <url>` | `1_snapshot.html` + cleaning artifacts `1_clean_snapshot.html`, `1_clean_style_snapshot.html`, `1_long_text.json`, `1_tables.json`, `1_code.json`; emits core params `skill-root`/`url-name`/`url-working-path` (redirected pages get the special `redirected_` name) + `redirect` notification |
| 2 Key-ID recognition | **agent** | reads `1_clean_snapshot.html` | `2_key_ids.json` |
| 3 Article-view rendering | script | `node script/render_article.mjs --url <url>` | `3_article.html` (chunks `3_article_chunk_X_of_N.html` when >60KB; the emitted `chunks` drives the step-4 dispatch mode) |
| 4 Markdown skeleton | **agent** | reads `3_article.html` (when split, subagents are dispatched in parallel per `chunks.files`, each writing `4_skeleton_chunk_X_of_N.json`) | `4_skeleton.json` / `4_skeleton_chunk_X_of_N.json` |
| 5 Restore + download + screenshot + render | script | `node script/render_markdown.mjs --url <url>` | `5_markdown.md` (final artifact), `assets/images/`, `assets/trans/` (the entry auto-detects and merges chunked skeletons) |

For each step's `status` decision table, the skeleton vocabulary, and constraints, see SKILL.md; for technical details of each script, see CLAUDE.md and the header comments of the scripts.
