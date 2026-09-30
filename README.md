# yh-InkLight

Read and annotate Markdown, PDF, and EPUB in Obsidian. Highlights, notes, tags, and reading progress are stored in separate sidecar JSON files so annotations do not change the original documents.

Requires **Obsidian 1.7.2 or later**. [中文说明](README.zh-CN.md).

## Features

- **Markdown annotations:** highlight text in Live Preview and Reading View, add comments, and jump back to the source.
- **PDF annotations:** display highlights as overlays, attach notes, and navigate to the original page.
- **EPUB reading:** read with the bundled foliate-js engine, switch between pagination and scrolling, search within books, and customize fonts, spacing, width, alignment, and themes.
- **Unified annotation sidebar:** browse Markdown, PDF, and EPUB annotations together; filter by color, type, and tag; edit comments; and export Markdown summaries.
- **Reading library:** browse books and PDFs with search, reading-status filters, progress, recent reading, and a cover grid.
- **Reading notes:** link PDFs and ebooks to generated Markdown notes. Annotation changes update only the explicitly managed section and preserve handwritten content outside it.
- **Return to source:** exported annotations use `obsidian://inklight` links to return to the relevant text, PDF page, or EPUB location.
- **Device preferences:** desktop, tablet, and phone keep their own EPUB layout preferences. An optional high-contrast e-ink mode applies to the plugin's reading interface.

## Installation

### Community directory

The plugin has been submitted to the Obsidian Community directory. Availability inside Obsidian depends on its automated review status.

When available, open **Settings -> Community plugins -> Browse**, search for **yh-InkLight**, install it, and enable it.

### BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. Add the repository `rezonegame/yh-inklight`.
3. Enable **yh-InkLight**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest GitHub release](https://github.com/rezonegame/yh-inklight/releases/latest).
2. Copy the files into `<vault>/.obsidian/plugins/yh-inklight/`.
3. Enable **yh-InkLight** under Community plugins.

After updating the EPUB engine, fully quit and restart Obsidian to reload its custom elements. To show EPUB files in the file explorer, enable **Detect all file extensions** under Files and links.

## Usage

Select text in a supported reader to highlight it or attach a comment. Open the annotation sidebar to browse, filter, edit, export, or return to annotations. Open the reading library to find books and PDFs in the vault.

Use the command palette for highlight, comment, annotation overview, reading library, and reading-note actions. Configure highlight colors, annotation tags, EPUB layout, reading-note folder, and PDF progress under **Settings -> yh-InkLight**.

## Storage and permissions

- Annotation data and reading progress are stored in `<vault>/.obsidian-annotations/` as sidecar JSON files. The plugin reads source documents and scans vault file paths to build its reading library.
- Generated reading notes and exported summaries are Markdown files inside the vault. Only a generated note's marked managed region is automatically synchronized; handwritten sections are preserved.
- EPUB layout preferences use device-local `localStorage`. Cover thumbnails use device-local IndexedDB. These caches are separate from annotation sidecars.
- Copy actions write selected text or annotation links to the clipboard.
- The EPUB engine is bundled in the release. No plugin account or subscription is required. Annotation storage does not depend on an external service.

Back up `.obsidian-annotations/` together with your vault to preserve annotations. Removing sidecars does not remove the original documents, but does remove the stored annotations and progress.

## Development

```sh
npm ci
npm run dev
npm run verify
npm run build
```

`npm run verify` runs the existing tests, TypeScript checks, and release metadata checks. Test built assets in a separate Obsidian vault.

## Release notes

### 0.23.6

- Address community review errors: preserve workspace leaf positions on unload; render toolbar icons through Obsidian's icon API; use standard settings headings and SVG style helpers; and remove a malformed CSS fragment.
- Build the annotation undo notice from a DocumentFragment so it does not require a notification API newer than the declared minimum app version.
- Provide this English README with the full Chinese documentation preserved separately, and correct the author profile link.

### 0.23.5

- Use the directory display name **yh-InkLight** and an English summary.
- Correct the minimum Obsidian version to 1.7.2. The plugin ID remains `yh-inklight`.
- Reading and annotation behavior remains the same as 0.23.4.

See [the Chinese documentation](README.zh-CN.md) and [GitHub releases](https://github.com/rezonegame/yh-inklight/releases) for earlier changes.

## License and attribution

MIT. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).

- [foliate-js](https://github.com/johnfactotum/foliate-js) provides the ebook rendering engine.
- [obsidian-pdf-plus](https://github.com/RyotaUshio/obsidian-pdf-plus) informed the adapted PDF text-layer offset implementation described in the third-party notices.
- Earlier integration work is documented in [the Chinese README](README.zh-CN.md).
