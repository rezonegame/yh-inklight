# Book Note

> Non-invasive reading annotation plugin for Obsidian. Annotate **PDF and EPUB** in one place — highlights, notes, and tags live in separate sidecar files, so your original documents are **never modified**.

[中文文档](./README.zh.md)

![Highlight in reading view](docs/images/highlight-with-book-note.png)
![Sticky notes overview](docs/images/sticky-notes-overview.png)

---

## Why Book Note

Most annotation tools mutate your source files. Book Note takes the opposite approach: every highlight, note, and reading-progress record is written to a sidecar JSON next to your vault's config, while the original document stays byte-for-byte intact. Rename, move, or delete a source file and the plugin migrates its annotations with it.

It started as a Markdown/PDF highlighter and grew into a full reading workspace focused on **PDF and EPUB**:

- **EPUB reading** powered by the [foliate-js](https://github.com/johnfactotz/foliate-js) engine
- **One unified sidebar** that aggregates annotations across PDF and EPUB
- **Excerpt export** and **bidirectional deep links** (`obsidian://book-note`) that jump back to the exact highlight

---

## Features

### EPUB reading (foliate-js engine)

- **Full reading experience** — pagination / scrolling, font-size control, and **6 reading themes** (Follow Obsidian, White, Warm, Eye-care Green, Parchment, Night).
- **6-color highlight + idea notes** — select text to open a floating toolbar; draw a highlight or attach a thought.
- **In-page full-text search** — search the current chapter from the toolbar.
- **Reading progress** — auto-saved position, elapsed reading time, and a remaining-time estimate.
- **Broad format support** — foliate-js natively reads EPUB, MOBI, AZW3, FB2, CBZ, and TXT.

### Unified annotation sidebar

- **One panel for all formats** — PDF and EPUB annotations converge in a single overview.
- **Filter & search** — filter by color, type, or semantic tag; keyword-search annotation content.
- **Semantic tags** — ships with *Insight*, *Question*, and *Reminder*; enable up to 5 tags, rename them, reorder, disable, and assign custom preset icons.
- **Inline editing** — edit a thought or add a note right inside the panel.
- **Jump back** — click a card to return to the original spot (PDF page / EPUB CFI).
- **Export** — Markdown summary, color-grouped export, or reading-notes layout.

### Unified export & bidirectional deep links

- **Export annotations** — one "Export annotations" action at the bottom of the sidebar exports PDF and EPUB marks together.
- **Unified deep links** — both excerpts and sidebar cards produce an `obsidian://book-note` link that returns to the exact PDF or EPUB annotation.
- **Backward-compatible backlinks** — hidden anchor points from older EPUB/PDF exports keep working after upgrade.

### PDF annotations

- Overlay highlight rectangles + sticky notes.
- Selection detection with color coding.
- All marks flow into the unified sidebar.

> **Note:** Book Note annotates **PDF and EPUB** files only. Markdown files in your vault are not annotated by this plugin.

---

## Installation

### Via BRAT (recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. BRAT → Add Plugin → enter the repository: `hellokunzai/obsidian-book-note`.
3. Enable **Book Note** after installation.
4. **Important:** after an update, fully quit and restart Obsidian (a plugin reload is not enough).

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [Releases](https://github.com/hellokunzai/obsidian-book-note/releases) page.
2. Place them in `<vault>/.obsidian/plugins/book-note/`.
3. Settings → Community plugins → enable **Book Note**.

### Opening EPUB files

Obsidian hides unknown extensions by default. To show `.epub` in the file explorer:

- Settings → Files & Links → enable **Detect all file extensions**.

---

## Settings

Configure under **Settings → Book Note**:

| Setting | Description |
|---------|-------------|
| Default highlight color | The color applied to new highlights. |
| Default author | Signature attached to your annotations. |
| Migrate annotations on rename | When a source file is renamed or moved, migrate its sidecar annotations and update links. |
| Annotation tags | Manage semantic tags — enable up to 5, rename, reorder, disable, assign a preset icon, or restore defaults. Duplicate names are blocked (whitespace / full-vs-half-width / case are normalized). |
| EPUB font size | Base body font size in px (12–28). Applies when you reopen the book. |
| EPUB reading theme | One of 6 themes. |
| EPUB flow mode | Paginated (page-turn) or Scrolled (continuous). |
| EPUB highlight style | Fill / Underline / Wavy underline. |
| PDF reading progress | Record the current page and reading progress. Disabling does not delete existing progress. |

---

## Commands & hotkeys

| Command | Hotkey | Action |
|---------|--------|--------|
| Highlight selection | `Ctrl/Cmd+Shift+H` | Highlight the selected text (PDF; EPUB uses its in-reader toolbar). |
| Add sticky note to selection | `Ctrl/Cmd+Alt+M` | Attach a thought/note to the selection. |
| Open annotation overview | — | Open the Book Note sidebar. |
| Open EPUB bookshelf | — | Browse e-books inside the vault. |
| Show PDF outline | — | List the current PDF's table of contents. |
| Test Book Note storage | — | Verify write access to the sidecar directory. |

> `Mod` maps to `Ctrl` on Windows/Linux and `Cmd` on macOS.

---

## Data storage

All annotation data lives in sidecar files under a configurable vault-relative directory (default `<vault>/.obsidian-annotations/`):

- One sidecar file per annotated file; choose **JSON** (compact) or **Markdown** (human-readable) storage in Settings → Storage. In Markdown format, metadata and reading progress live in YAML frontmatter and each annotation becomes its own heading.
- Stores highlights, notes, reading progress, plus legacy fields kept for backward compatibility.
- **Your original documents are never touched** — delete a sidecar file to erase that file's annotations.
- Change the storage folder or format in Settings → Storage; existing annotations are migrated automatically.

```text
.obsidian-annotations/          # default folder (configurable)
  index.json                   # index of all sidecars (basic info only)
  papers-example.pdf.json      # PDF annotations (JSON format). Name = path segments joined by "-", original filename + extension, then .json/.md
  papers-example.pdf.md        # PDF annotations (Markdown format, if enabled)
  books-novel.epub.json        # EPUB annotations (CFI anchors + reading progress)
```

### Deep links

Book Note emits links of the form:

```text
obsidian://book-note?file=<vault-relative-path>&id=<annotation-id>
obsidian://book-note-epub?file=<vault-relative-path>&cfi=<epub-cfi>   # legacy EPUB links
```

Clicking a link opens the file and scrolls to the exact annotation.

---

## Technical architecture

- **EPUB engine:** [foliate-js](https://github.com/johnfactotz/foliate-js) 1.0.1 — a single engine covering multiple formats natively.
- **Rendering:** a `foliate-view` custom element embedded in an Obsidian leaf, with CSP / sandbox patches for the desktop runtime.
- **Data layer:** sidecar JSON via `AnnotationStore`, unified into a `FileAnnotationDocument` model.
- **Annotation sync:** `renderedAnnotationMeta` tracks the foliate highlight layer so add/remove operations refresh immediately.
- **Non-invasive by design:** every annotation is an overlay; the source text is never rewritten.

---

## Development

```bash
npm install
npm run dev      # development build (with sourcemap)
npm run build    # production build
```

Type-check:

```bash
npx tsc --noEmit
```

Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/book-note/` to test in a vault.

---

## License

[MIT](./LICENSE)

## Acknowledgements

- [foliate-js](https://github.com/johnfactotz/foliate-js) — EPUB rendering engine.
- [obsidian-weave-reader](https://github.com/) — foliate integration, footnote / search / canvas references.
- [ob-epub-reader](https://github.com/) — excerpt back-link and deep-link approach.
- [Axl Light](https://github.com/rezonegame/axl-light) — original project basis.
