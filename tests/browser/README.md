# EPUB wheel regression fixture

Uses the production Foliate loader, CSP iframe patch, layout controller and
navigation controller with two synthetic chapters. No real book or sidecar is
read or written. Generated assets are disposable and must not be committed.

From the repository root:

```powershell
npx esbuild tests/browser/epub-wheel.ts --bundle --format=iife --platform=browser --alias:obsidian=./tests/support/obsidian-stub.mjs --outfile=.browser-test/epub-wheel.js
python -m http.server 8768 --bind 127.0.0.1
```

Open `http://127.0.0.1:8768/tests/browser/epub-wheel.html` in a browser.
Stop the server after testing and remove only the generated `.browser-test`
directory after verifying its resolved path is inside this repository.

Expected checks:

- Scrolled: `scrolled=true`, `columnWidth=auto`, content extent exceeds viewport.
- At chapter start: +24px -> 24; +900px -> 144; +1 page -> 224;
  20 x 2px -> 264. `pageTurns` stays zero.
- Real wheel over book text moves incrementally, at most 120px per event (or
  one quarter viewport height in shorter windows), not one screen.
- Chapter end followed by +24px opens chapter 2 at position 0 even with
  fractional layout dimensions; -24px at chapter 2 start returns to chapter 1.
- Paginated: columns return, wheel uses the supplied page-turn host callback.
- Arrow keys inside the book still work; arrows/wheel over Search or book input
  do not navigate. Ctrl/Meta wheel retains native zoom behavior.
- Switching flow repeatedly and unloading/reopening must not duplicate input.

This browser fixture does not replace Obsidian BRAT testing, Android/tablet
testing, or testing the user's specific EPUB and physical input device.
