# Book Note Obsidian Community Plugin Submission Checklist

Use this checklist before submitting Book Note to `obsidianmd/obsidian-releases`.

## Repository Readiness

- [ ] Confirm `manifest.json` uses plugin id `book-note`.
- [ ] Confirm `manifest.json` version matches the GitHub release tag.
- [ ] Confirm `manifest.json` includes `name`, `version`, `minAppVersion`, `description`, `author`, `authorUrl`, and `isDesktopOnly`.
- [ ] Confirm `isDesktopOnly` is `false`.
- [ ] Confirm `README.md` explains that Book Note never modifies Markdown or PDF files.
- [ ] Confirm `LICENSE` exists and matches the README license section.

## Runtime Safety

- [ ] Run `rg "require\\(|from ['\\\"]fs|from ['\\\"]path|eval\\(|new Function|fetch\\(|console\\." main.ts src styles.css manifest.json README.md`.
- [ ] Confirm there is no Node.js filesystem API in plugin runtime code.
- [ ] Confirm there is no `eval()` or `new Function()`.
- [ ] Confirm there are no external network requests.
- [ ] Confirm all vault writes go through Obsidian `app.vault` or `app.vault.adapter`.
- [ ] Confirm annotations are stored under `.obsidian-annotations/`.
- [ ] Confirm original Markdown and PDF files are not modified during highlight or note creation.

## CSS and UI

- [ ] Confirm all custom CSS classes use the `.book-note-` prefix.
- [ ] Confirm TypeScript DOM class references use `book-note-` classes.
- [ ] Confirm custom data attributes use `data-book-note-*`.
- [ ] Test light theme and dark theme readability.
- [ ] Test narrow pane behavior.

## Build

- [ ] Run `npm install`.
- [ ] Run `npm exec tsc -- --noEmit -p tsconfig.json`.
- [ ] Run `npm run build`.
- [ ] Confirm release assets exist: `main.js`, `manifest.json`, `styles.css`.
- [ ] Install the built assets into a clean test vault.

## Functional Testing

- [ ] Markdown Live Preview: highlight, sticky note, edit, delete, jump, export.
- [ ] Markdown Reading View desktop: highlights render and popover opens.
- [ ] Markdown Reading View mobile: highlights render after delayed DOM stabilization.
- [ ] PDF: highlight, sticky note, sidebar listing, jump, delete.
- [ ] Windows path test: sidecar filenames use normalized paths and safe separators.
- [ ] Rename test: note file rename migrates sidecar data when enabled.
- [ ] Export test: generated notes file contains highlights and comments.

## Release

- [ ] Update `manifest.json` version.
- [ ] Update `versions.json`.
- [ ] Update `package.json` version.
- [ ] Commit changes.
- [ ] Create a GitHub release tag matching `manifest.json`.
- [ ] Attach `main.js`, `manifest.json`, and `styles.css` to the release.
- [ ] Verify BRAT can install the repository.

## obsidian-releases PR

- [ ] Fork `https://github.com/obsidianmd/obsidian-releases`.
- [ ] Add Book Note to `community-plugins.json` with id `book-note`.
- [ ] Add version entry to the release metadata as required by the current Obsidian submission instructions.
- [ ] Open a PR from the fork to `obsidianmd/obsidian-releases`.
- [ ] Include a short summary, repository URL, release URL, and testing notes.
