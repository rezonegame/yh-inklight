# Axl Light

Axl Light is a non-invasive Obsidian reading annotation plugin for Markdown and PDF files. It adds overlay highlights, sticky notes, search, jump, and Markdown export while keeping your original documents clean.

**This plugin never modifies your Markdown or PDF files.** Annotation data is stored separately in sidecar JSON files under `.obsidian-annotations/`.

## Features

- Overlay highlights for Markdown Live Preview, Source Mode, Reading View, and PDFs
- Mobile-friendly Reading View highlight recovery with delayed rendering and DOM observation
- Floating toolbar with six colors, sticky note, copy, and annotation overview actions
- Right-side sticky note lane with Markdown-rendered notes
- Inline editing for sticky notes and sidebar notes
- Sidebar overview with search, color filtering, sorting, jump, delete, add-note, and export
- Sidecar JSON storage with fuzzy text-anchor relocation
- Windows-safe path normalization and rename migration handling

## Installation

### BRAT

1. Install the Obsidian BRAT plugin.
2. Run `BRAT: Add a beta plugin for testing`.
3. Paste this repository URL:

```text
https://github.com/little-pond/axl-light
```

4. Enable `Axl Light` in `Settings -> Community plugins`.

### Quick Install

Run this in Terminal. Replace the path with your Obsidian vault path:

```bash
curl -fsSL https://raw.githubusercontent.com/little-pond/axl-light/main/scripts/install.sh | bash -s -- "$HOME/Documents/Obsidian Vault"
```

Then restart Obsidian, open Settings → Community plugins, and enable Axl Light.

![Install Axl Light from Terminal](docs/images/install-axl-light-command.png)

### Manual Install

1. Download these three files from the latest release:
   https://github.com/little-pond/axl-light/releases/latest

   - `main.js`
   - `manifest.json`
   - `styles.css`

2. Move them to:
   `<your-vault>/.obsidian/plugins/axl-light/`

3. Restart Obsidian

4. Settings → Community plugins → Enable "Axl Light"

Do **not** download the source code ZIP from the green `Code` button. Obsidian needs the built release files.

## Usage

### Highlight Text

Select text in Markdown or PDF. Use the floating toolbar to choose a color, add a sticky note, copy the selection, or open the overview.

![Highlight with Axl Light](docs/images/highlight-with-axl-light.png)

### Edit Sticky Notes

Open the right-side sticky note lane or the annotation overview. Click the pencil button to edit a note inline. Press `Cmd/Ctrl + Enter` to save.

![Sticky notes and annotation overview](docs/images/sticky-notes-overview.png)

### Search, Jump, and Export

Use the annotation overview to search highlights and notes, jump back to the source position, delete annotations, add notes to existing highlights, or export everything into a new Markdown notes file.

## Commands

- `Highlight selected text`: `Cmd/Ctrl + Shift + H`
- `Add sticky note to selection`: `Cmd/Ctrl + Alt + M`
- `Toggle sticky note lane`: `Cmd/Ctrl + Shift + N`
- `Open annotation overview`

## Data Storage

Axl Light stores annotations in your vault:

```text
.obsidian-annotations/
  index.json
  notes__reading__book.md.json
  papers__example.pdf.json
```

The sidecar files contain anchors, selected text, colors, sticky note content, optional titles, timestamps, and PDF page rectangles.

Your original `.md` and `.pdf` files remain unchanged. If you disable or remove the plugin, your documents stay clean.

## Known Limitations

- Reading View highlights are matched against rendered DOM text, so unusual themes or plugins that heavily rewrite rendered HTML may affect placement.
- PDF support depends on Obsidian's built-in PDF viewer DOM structure.
- PDF text selection and rectangle anchors may need relocation improvements for rotated pages or unusual PDF layouts.
- Very large annotation sets currently render directly in the sidebar; virtual scrolling is planned.

## Development

```bash
npm install
npm run dev
```

For production builds:

```bash
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<your-vault>/.obsidian/plugins/axl-light/
```

## License

MIT. See [LICENSE](LICENSE).
