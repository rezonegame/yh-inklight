/**
 * [INPUT]: Uses built-in Node.js fs/path and local carousel copy constants.
 * [OUTPUT]: Generates 1080x1350 SVG slides for the Axl Light LinkedIn carousel.
 * [POS]: docs/linkedin-carousel asset generator; deterministic visual source for export images.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "exports");
mkdirSync(outDir, { recursive: true });

const W = 1080;
const H = 1350;
const screenshotsDir = join(here, "..", "images");
const IMG_HIGHLIGHT = pathToFileURL(join(screenshotsDir, "highlight-with-axl-light.png")).href;
const IMG_STICKY = pathToFileURL(join(screenshotsDir, "sticky-notes-overview.png")).href;
const IMG_INSTALL = pathToFileURL(join(screenshotsDir, "install-axl-light-command.png")).href;

const slides = [
  {
    kicker: "Axl Light for Obsidian",
    title: ["I built an", "Obsidian reading", "annotation plugin"],
    subtitle: "Markdown / PDF highlights, sticky notes, search, jump, export. Original files stay clean.",
    badge: "01 / 07",
    scene: "hero",
  },
  {
    kicker: "The pain",
    title: ["I wanted to mark up", "my reading, not", "mess up my vault"],
    subtitle: "Inline Markdown highlights are fine for a minute. Long term, the source file turns noisy.",
    badge: "02 / 07",
    scene: "dirty",
  },
  {
    kicker: "Highlight flow",
    title: ["Select text.", "Pick a color.", "Keep reading."],
    subtitle: "Highlights are visual overlays. The Markdown source is not modified.",
    badge: "03 / 07",
    scene: "toolbar",
  },
  {
    kicker: "Overview cards",
    title: ["Highlights and notes", "stay together"],
    subtitle: "Each passage becomes one clean card: quote, note, Jump, edit, export.",
    badge: "04 / 07",
    scene: "sticky",
  },
  {
    kicker: "After reading",
    title: ["Search. Jump.", "Export to Markdown."],
    subtitle: "Turn highlights and notes into a new usable note instead of a graveyard of yellow lines.",
    badge: "05 / 07",
    scene: "search",
  },
  {
    kicker: "Non-invasive by design",
    title: ["Annotations are", "annotations.", "Files are files."],
    subtitle: "Markdown and PDFs stay untouched. Annotation data is stored in sidecar JSON files.",
    badge: "06 / 07",
    scene: "sidecar",
  },
  {
    kicker: "Open source",
    title: ["If you read inside", "Obsidian, try it."],
    subtitle: "github.com/little-pond/axl-light",
    badge: "07 / 07",
    scene: "cta",
  },
];

for (const [index, slide] of slides.entries()) {
  writeFileSync(join(outDir, `slide-${index + 1}.svg`), renderSlide(slide), "utf8");
}

function renderSlide(slide) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fffaf0"/>
      <stop offset="58%" stop-color="#fffdf8"/>
      <stop offset="100%" stop-color="#f7ead1"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffe27a"/>
      <stop offset="100%" stop-color="#f2b712"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#6b4a00" flood-opacity="0.16"/>
    </filter>
    <filter id="tinyShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#4d3600" flood-opacity="0.14"/>
    </filter>
    <pattern id="dots" width="36" height="36" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="3" r="1.4" fill="#efd28a" opacity="0.35"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#paper)"/>
  <rect width="${W}" height="${H}" fill="url(#dots)" opacity="0.55"/>
  ${paperTexture()}
  ${brandHeader(slide.badge)}
  ${tag(slide.kicker)}
  ${titleBlock(slide.title)}
  ${subtitleBlock(slide.subtitle)}
  ${scene(slide.scene)}
  ${footer()}
</svg>`;
}

function brandHeader(badge) {
  return `
  <g transform="translate(58 42)">
    <rect x="0" y="0" width="58" height="58" rx="16" fill="url(#gold)" filter="url(#tinyShadow)"/>
    <path d="M19 39 L23 23 L36 10 C41 13 45 17 48 22 L35 35 Z" fill="none" stroke="#121212" stroke-width="5" stroke-linejoin="round"/>
    <path d="M17 44 H40" stroke="#121212" stroke-width="5" stroke-linecap="round"/>
    <text x="78" y="25" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="30" font-weight="800" fill="#121212">Axl Light</text>
    <text x="78" y="55" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="19" fill="#666">Obsidian reading annotations</text>
  </g>
  <g transform="translate(902 50)">
    <rect x="0" y="0" width="118" height="48" rx="18" fill="url(#gold)" filter="url(#tinyShadow)"/>
    <text x="59" y="31" text-anchor="middle" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="22" font-weight="800" fill="#121212">${escapeXml(badge)}</text>
  </g>`;
}

function tag(text) {
  return `
  <g transform="translate(64 154)">
    <rect x="0" y="0" width="${Math.max(210, text.length * 14)}" height="54" rx="18" fill="#ffe082" opacity="0.92"/>
    <text x="25" y="35" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="21" font-weight="800" fill="#171717">✦ ${escapeXml(text)}</text>
  </g>`;
}

function titleBlock(lines) {
  return `
  <text x="70" y="300" font-family="Georgia, 'Times New Roman', serif" font-size="82" font-weight="900" fill="#111" letter-spacing="-2">
    ${lines.map((line, i) => `<tspan x="70" dy="${i === 0 ? 0 : 94}">${escapeXml(line)}</tspan>`).join("")}
  </text>
  <path d="M72 594 C244 576, 476 577, 810 590" fill="none" stroke="#f5c518" stroke-width="13" stroke-linecap="round" opacity="0.82"/>`;
}

function subtitleBlock(text) {
  return `
  <text x="74" y="652" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="31" font-weight="600" fill="#1c1c1c">
    ${wrap(text, 52).map((line, i) => `<tspan x="74" dy="${i === 0 ? 0 : 42}">${escapeXml(line)}</tspan>`).join("")}
  </text>`;
}

function scene(name) {
  const map = {
    hero: heroScene,
    dirty: dirtyScene,
    toolbar: toolbarScene,
    sticky: stickyScene,
    search: searchScene,
    sidecar: sidecarScene,
    cta: ctaScene,
  };
  return map[name]();
}

function heroScene() {
  return `
  ${obsidianSurface(70, 742, 940, 529, "overview")}
  <g transform="translate(128 1186)">
    <rect x="0" y="0" width="335" height="48" rx="18" fill="#fff7cd" stroke="#f2c94c" filter="url(#tinyShadow)"/>
    <text x="22" y="31" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="19" font-weight="800" fill="#241c00">Real Obsidian UI, not a mock app</text>
  </g>
  <path d="M580 914 C656 880, 742 886, 842 936" fill="none" stroke="#f5c518" stroke-width="6" stroke-linecap="round" stroke-dasharray="10 10"/>`;
}

function dirtyScene() {
  return `
  <g transform="translate(94 750)" filter="url(#softShadow)">
    <rect x="0" y="0" width="400" height="310" rx="26" fill="#fff"/>
    <text x="34" y="58" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="26" font-weight="800" fill="#111">Before</text>
    <text x="34" y="118" font-family="Menlo, Monaco, monospace" font-size="21" fill="#333">==important line==</text>
    <text x="34" y="166" font-family="Menlo, Monaco, monospace" font-size="21" fill="#333">&gt; random note</text>
    <text x="34" y="214" font-family="Menlo, Monaco, monospace" font-size="21" fill="#333">%% reminder %%</text>
    <path d="M30 242 C120 234, 258 236, 340 246" fill="none" stroke="#ff6b6b" stroke-width="8" stroke-linecap="round"/>
    <text x="34" y="280" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="19" fill="#b33">source file gets noisy</text>
  </g>
  <g transform="translate(586 750)" filter="url(#softShadow)">
    <rect x="0" y="0" width="400" height="310" rx="26" fill="#fff"/>
    <text x="34" y="58" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="26" font-weight="800" fill="#111">Axl Light</text>
    <text x="34" y="118" font-family="Menlo, Monaco, monospace" font-size="21" fill="#333">important line</text>
    <rect x="31" y="93" width="185" height="34" rx="8" fill="#ffe16a" opacity="0.72"/>
    <text x="34" y="166" font-family="Menlo, Monaco, monospace" font-size="21" fill="#333">plain Markdown</text>
    <text x="34" y="214" font-family="Menlo, Monaco, monospace" font-size="21" fill="#333">clean forever</text>
    <path d="M31 246 C142 232, 252 235, 350 245" fill="none" stroke="#f5c518" stroke-width="8" stroke-linecap="round"/>
    <text x="34" y="280" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="19" fill="#6b5400">annotations live outside</text>
  </g>`;
}

function toolbarScene() {
  return `
  ${screenshotFrame(70, 742, 940, 529, IMG_HIGHLIGHT)}
  <g transform="translate(152 1156)">
    <rect x="0" y="0" width="508" height="58" rx="29" fill="#fff" stroke="#e9dcc2" filter="url(#tinyShadow)"/>
    ${["#f5c518", "#ff8c00", "#ff69b4", "#52c41a", "#1677ff", "#722ed1"].map((c, i) => `<circle cx="${44 + i * 43}" cy="29" r="13" fill="${c}"/>`).join("")}
    <text x="318" y="37" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="21" font-weight="800" fill="#111">floating toolbar</text>
  </g>
  <path d="M264 1110 C340 1140, 470 1134, 612 1104" fill="none" stroke="#f5c518" stroke-width="6" stroke-linecap="round" stroke-dasharray="9 9"/>`;
}

function stickyScene() {
  return `
  ${obsidianSurface(70, 730, 940, 529, "merged")}
  <g transform="translate(596 1142)">
    <rect x="0" y="0" width="350" height="92" rx="22" fill="#fff7cd" stroke="#f2c94c" filter="url(#tinyShadow)"/>
    <circle cx="30" cy="34" r="8" fill="#7b3dd6"/>
    <text x="48" y="41" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="18" font-weight="800" fill="#222">one card per passage</text>
    <text x="30" y="70" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="16" fill="#333">highlight + note are merged together</text>
  </g>
  <path d="M650 1008 C704 1060, 726 1104, 596 1182" fill="none" stroke="#7b3dd6" stroke-width="5" stroke-linecap="round" stroke-dasharray="8 8" opacity="0.75"/>`;
}

function searchScene() {
  return `
  ${obsidianSurface(70, 742, 940, 529, "search")}
  <g transform="translate(112 1100)" filter="url(#softShadow)">
    <rect x="0" y="0" width="856" height="120" rx="24" fill="#fff"/>
    <rect x="28" y="24" width="384" height="50" rx="18" fill="#f9f6ee" stroke="#ead7a6"/>
    <text x="54" y="57" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="19" fill="#444">Search notes: “decision boundary”</text>
    <rect x="454" y="24" width="102" height="50" rx="16" fill="#f5c518"/>
    <text x="505" y="56" text-anchor="middle" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="18" font-weight="800" fill="#111">Jump</text>
    <rect x="574" y="24" width="126" height="50" rx="16" fill="#111"/>
    <text x="637" y="56" text-anchor="middle" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="18" font-weight="800" fill="#fff">Export</text>
    <text x="28" y="98" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="16" fill="#777">The UI above is the actual Obsidian plugin surface.</text>
  </g>`;
}

function sidecarScene() {
  return `
  <g transform="translate(92 740)" filter="url(#softShadow)">
    <rect x="0" y="0" width="896" height="420" rx="28" fill="#fff"/>
    <g transform="translate(46 58)">
      <rect x="0" y="0" width="365" height="260" rx="20" fill="#fbfbfb" stroke="#e5e5e5"/>
      <text x="28" y="50" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="24" font-weight="850" fill="#111">book.md</text>
      <text x="28" y="100" font-family="Menlo, Monaco, monospace" font-size="20" fill="#333">Clean Markdown</text>
      <text x="28" y="140" font-family="Menlo, Monaco, monospace" font-size="20" fill="#333">No ==marks==</text>
      <text x="28" y="180" font-family="Menlo, Monaco, monospace" font-size="20" fill="#333">No hidden notes</text>
    </g>
    <path d="M430 190 C474 154, 500 154, 544 190" fill="none" stroke="#f5c518" stroke-width="8" stroke-linecap="round"/>
    <g transform="translate(548 58)">
      <rect x="0" y="0" width="305" height="260" rx="20" fill="#fffbea" stroke="#f2c94c"/>
      <text x="24" y="50" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="22" font-weight="850" fill="#111">sidecar JSON</text>
      <text x="24" y="104" font-family="Menlo, Monaco, monospace" font-size="17" fill="#333">.obsidian-annotations/</text>
      <text x="24" y="146" font-family="Menlo, Monaco, monospace" font-size="17" fill="#333">highlights[]</text>
      <text x="24" y="188" font-family="Menlo, Monaco, monospace" font-size="17" fill="#333">comments[]</text>
    </g>
  </g>`;
}

function obsidianSurface(x, y, width, height, variant) {
  const scaleX = width / 940;
  const scaleY = height / 529;
  const searchValue = variant === "search" ? "decision boundary" : "Search annotations...";
  const secondCardButton = variant === "merged" ? "Add note" : "Jump";
  return `
  <g transform="translate(${x} ${y}) scale(${scaleX} ${scaleY})" filter="url(#softShadow)">
    <rect x="0" y="0" width="940" height="529" rx="28" fill="#fff"/>
    <rect x="0" y="0" width="940" height="48" rx="28" fill="#fbfbfb"/>
    <rect x="0" y="28" width="940" height="20" fill="#fbfbfb"/>
    <circle cx="26" cy="24" r="6" fill="#ff5f57"/>
    <circle cx="46" cy="24" r="6" fill="#ffbd2e"/>
    <circle cx="66" cy="24" r="6" fill="#28c840"/>
    <text x="124" y="30" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#555">Axl Light demo vault</text>
    <rect x="0" y="48" width="54" height="481" fill="#f7f7f8"/>
    <rect x="54" y="48" width="186" height="481" fill="#fbfbfb"/>
    <rect x="240" y="48" width="410" height="481" fill="#fff"/>
    <rect x="650" y="48" width="290" height="481" fill="#fffdf8"/>
    <line x1="54" y1="48" x2="54" y2="529" stroke="#e5e1d8"/>
    <line x1="240" y1="48" x2="240" y2="529" stroke="#e5e1d8"/>
    <line x1="650" y1="48" x2="650" y2="529" stroke="#e5e1d8"/>

    ${obsidianRail()}
    ${vaultTree()}
    ${readerPane()}
    ${overviewPane(searchValue, secondCardButton)}
    <rect x="0" y="0" width="940" height="529" rx="28" fill="none" stroke="#eadfca" stroke-width="2"/>
  </g>`;
}

function obsidianRail() {
  return `
    <g fill="none" stroke="#8a8a8a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.82">
      <path d="M26 86h9v9h-9z"/>
      <path d="M26 126h10M31 121v10"/>
      <path d="M25 166h12M25 172h12M25 178h8"/>
      <path d="M26 216l5-5 5 5-5 5z"/>
      <circle cx="31" cy="262" r="6"/>
      <path d="M25 312h12M31 306v12"/>
      <path d="M26 438h10M26 446h10"/>
      <circle cx="31" cy="482" r="5"/>
    </g>`;
}

function vaultTree() {
  return `
    <text x="78" y="84" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="14" font-weight="800" fill="#202020">Knowledge Vault</text>
    <g font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="12" fill="#555">
      <text x="82" y="126">Daily Notes</text>
      <text x="82" y="158">Reading Notes</text>
      <rect x="68" y="178" width="152" height="28" rx="8" fill="#efe8ff"/>
      <text x="82" y="197" font-weight="700" fill="#4b2db7">AI product essay</text>
      <text x="82" y="234">Papers</text>
      <text x="82" y="266">Course PDFs</text>
      <text x="82" y="298">Writing drafts</text>
    </g>`;
}

function readerPane() {
  return `
    <text x="274" y="92" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="13" fill="#777">~/ Reading Notes / AI product essay.md</text>
    <text x="274" y="138" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="24" font-weight="850" fill="#171717">AI product thinking</text>
    <g font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="15" fill="#222">
      <text x="274" y="184">The hard part is not shipping more features.</text>
      <rect x="274" y="205" width="308" height="22" rx="5" fill="#fff0a6"/>
      <text x="274" y="222">The product must understand the user at</text>
      <rect x="274" y="230" width="244" height="22" rx="5" fill="#fff0a6"/>
      <text x="274" y="247">the moment they need help.</text>
      <text x="274" y="296">Good interfaces should make the next step obvious,</text>
      <rect x="274" y="318" width="322" height="22" rx="5" fill="#efe0ff"/>
      <text x="274" y="335">not force people to remember the system.</text>
      <text x="274" y="384">The note belongs near the sentence, but the source</text>
      <text x="274" y="411">file should stay clean.</text>
    </g>
    <g transform="translate(286 446)">
      <rect x="0" y="0" width="286" height="40" rx="10" fill="#f6f0ff" stroke="#e0d2ff"/>
      <text x="18" y="25" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="13" fill="#6f55a8">Annotations live in sidecar files, not in Markdown.</text>
    </g>`;
}

function overviewPane(searchValue, secondCardButton) {
  return `
    <g transform="translate(670 68)">
      <g>
        <text x="0" y="18" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="16" font-weight="850" fill="#171717">Annotation Overview</text>
        <text x="248" y="18" text-anchor="middle" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="16" fill="#888">×</text>
      </g>
      <rect x="0" y="36" width="210" height="30" rx="8" fill="#fff" stroke="#e6dfd0"/>
      <text x="14" y="56" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="11" fill="#8b8170">${escapeXml(searchValue)}</text>
      <rect x="218" y="36" width="30" height="30" rx="8" fill="#fff" stroke="#e6dfd0"/>
      <path d="M226 45h14l-5 6v6l-4 2v-8z" fill="none" stroke="#777" stroke-width="1.5" stroke-linejoin="round"/>
      <g transform="translate(0 78)">
        <rect x="0" y="0" width="76" height="28" rx="7" fill="#fff" stroke="#e6dfd0"/>
        <text x="10" y="18" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="10.5" fill="#333">All colors</text>
        <rect x="86" y="0" width="72" height="28" rx="7" fill="#fff" stroke="#e6dfd0"/>
        <text x="96" y="18" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="10.5" fill="#333">All types</text>
        <rect x="168" y="0" width="80" height="28" rx="7" fill="#fff" stroke="#e6dfd0"/>
        <text x="178" y="18" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="10.5" fill="#333">Newest</text>
      </g>
      <text x="0" y="126" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="11" fill="#777">2 highlights · 1 note</text>
      ${overviewCard(0, 142, "purple", "highlight", "01:29 PM", "not force people to remember the system.", "This is exactly the kind of sentence I want to revisit when writing.", "AI product essay.md", "Markdown", "edit")}
      ${overviewCard(0, 304, "yellow", "highlight", "01:31 PM", "The product must understand the user at the moment they need help.", "", "AI product essay.md", "Markdown", secondCardButton)}
    </g>`;
}

function overviewCard(x, y, color, type, time, quote, content, file, mode, action) {
  const actionButton = action === "edit"
    ? `<rect x="0" y="112" width="28" height="24" rx="12" fill="#fff" stroke="#decfba"/><path d="M9 124l1.5-5.4 7.4-7.4 3.2 3.2-7.4 7.4z" fill="none" stroke="#555" stroke-width="1.4" stroke-linejoin="round"/>`
    : `<rect x="0" y="112" width="68" height="24" rx="12" fill="#fff" stroke="#decfba"/><text x="34" y="128" text-anchor="middle" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="10.5" fill="#222">Add note</text>`;
  const jumpX = action === "edit" ? 36 : 76;
  const deleteX = jumpX + 50;
  return `
      <g transform="translate(${x} ${y})">
        <rect x="0" y="0" width="248" height="${content ? 148 : 140}" rx="12" fill="${cardFill(color)}" stroke="#eadfca" filter="url(#tinyShadow)"/>
        <rect x="12" y="13" width="${color.length * 8 + 18}" height="20" rx="10" fill="${labelFill(color)}"/>
        <text x="22" y="27" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="10.5" font-weight="800" fill="${labelText(color)}">${color}</text>
        <text x="82" y="27" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="10.5" fill="#777">md</text>
        <text x="106" y="27" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="10.5" fill="#aaa">·</text>
        <text x="118" y="27" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="10.5" fill="#777">${type}</text>
        <text x="236" y="27" text-anchor="end" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="10.5" fill="#777">${time}</text>
        <rect x="12" y="44" width="224" height="32" rx="7" fill="rgba(0,0,0,0.05)"/>
        <text x="22" y="58" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="10.8" font-weight="700" fill="#222">${escapeXml(truncate(quote, 42))}</text>
        ${content ? `<text x="14" y="96" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="11.5" fill="#222">${wrap(content, 36).slice(0, 2).map((line, index) => `<tspan x="14" dy="${index === 0 ? 0 : 15}">${escapeXml(line)}</tspan>`).join("")}</text>` : ""}
        <text x="14" y="${content ? 132 : 102}" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="10.5" fill="#777">${escapeXml(file)}</text>
        <text x="236" y="${content ? 132 : 102}" text-anchor="end" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="10.5" fill="#777">${mode}</text>
        ${actionButton}
        <rect x="${jumpX}" y="112" width="44" height="24" rx="12" fill="#fff" stroke="#decfba"/>
        <text x="${jumpX + 22}" y="128" text-anchor="middle" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="10.5" fill="#222">Jump</text>
        <rect x="${deleteX}" y="112" width="54" height="24" rx="12" fill="#fff" stroke="#decfba"/>
        <text x="${deleteX + 27}" y="128" text-anchor="middle" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="10.5" fill="#b23636">Delete</text>
      </g>`;
}

function cardFill(color) {
  return {
    yellow: "#fffbea",
    orange: "#fff4ea",
    pink: "#fef0f5",
    green: "#f0fff4",
    blue: "#f0f4ff",
    purple: "#f5f0ff",
  }[color] ?? "#fffbea";
}

function labelFill(color) {
  return {
    yellow: "#fff3c4",
    orange: "#ffe8d0",
    pink: "#ffd6e8",
    green: "#d0f0d8",
    blue: "#d0e4ff",
    purple: "#e8d0ff",
  }[color] ?? "#fff3c4";
}

function labelText(color) {
  return {
    yellow: "#92700a",
    orange: "#a04b00",
    pink: "#a0006b",
    green: "#006b2b",
    blue: "#003da0",
    purple: "#5500a0",
  }[color] ?? "#92700a";
}

function ctaScene() {
  return `
  ${screenshotFrame(86, 734, 908, 511, IMG_INSTALL)}
  <g transform="translate(110 1035)" filter="url(#softShadow)">
    <rect x="0" y="0" width="860" height="234" rx="32" fill="#111" opacity="0.96"/>
    <text x="52" y="82" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="28" font-weight="850" fill="#ffe16a">Install / Star / Try it</text>
    <text x="52" y="148" font-family="Menlo, Monaco, monospace" font-size="24" fill="#fff">github.com/little-pond/axl-light</text>
    <text x="52" y="196" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="22" fill="#ddd">Built for readers who want clean source files.</text>
  </g>`;
}

function footer() {
  return `
  <path d="M0 1268 C150 1238, 282 1275, 432 1242 C590 1208, 750 1269, 1080 1228 L1080 1350 L0 1350 Z" fill="#fff" opacity="0.78"/>
  <text x="540" y="1296" text-anchor="middle" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-size="23" font-weight="700" fill="#2f2a1d">Read deeply. Keep the source clean.</text>
  <path d="M458 1315 C508 1296, 608 1298, 668 1311" fill="none" stroke="#f5c518" stroke-width="5" stroke-linecap="round"/>`;
}

function paperTexture() {
  return `
  <circle cx="924" cy="244" r="112" fill="#f5c518" opacity="0.10"/>
  <circle cx="122" cy="1095" r="132" fill="#f0c15c" opacity="0.10"/>
  <path d="M890 640 C930 620, 982 620, 1020 650" fill="none" stroke="#d7a51a" stroke-width="5" opacity="0.24"/>
  <path d="M42 456 C96 426, 154 432, 204 466" fill="none" stroke="#d7a51a" stroke-width="5" opacity="0.18"/>`;
}

function wrap(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function truncate(text, maxChars) {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function screenshotFrame(x, y, width, height, href) {
  return `
  <g transform="translate(${x} ${y})" filter="url(#softShadow)">
    <rect x="0" y="0" width="${width}" height="${height}" rx="28" fill="#fff"/>
    <clipPath id="clip-${Math.round(x)}-${Math.round(y)}">
      <rect x="0" y="0" width="${width}" height="${height}" rx="28"/>
    </clipPath>
    <image href="${escapeXml(href)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${Math.round(x)}-${Math.round(y)})"/>
    <rect x="0" y="0" width="${width}" height="${height}" rx="28" fill="none" stroke="#eadfca" stroke-width="2"/>
  </g>`;
}
