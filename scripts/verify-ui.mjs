import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = process.cwd();
const output = path.join(root, "output", "playwright");
await mkdir(output, { recursive: true });
const bundle = await build({ entryPoints: ["tests/browser/stability.ts"], bundle: true, write: false, format: "iife", platform: "browser", alias: { obsidian: path.join(root, "tests/support/obsidian-stub.mjs") } });
const css = await readFile("styles.css", "utf8");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>InkLight stability fixture</title><style>
:root { --yh-font-base:16px;--yh-font-md:18px;--yh-font-sm:14px;--yh-font-xs:12px;--yh-border:#ddd;--yh-radius:6px;--yh-radius-sm:4px;--background-primary:#fff;--background-secondary:#f6f7f8;--text-normal:#242424;--text-muted:#636363;--text-faint:#777;--yh-yellow:#e0b700;--yh-yellow-hover:#715b00;--yh-yellow-bg:#fff7cb;--background-modifier-border:#ddd; }
body { margin:0;background:white;color:#242424;font:16px system-ui;height:100dvh; }#app,.fixture-leaf { height:100%;min-height:0; } .fixture-leaf { max-width:420px;margin:auto; }button,input,select,textarea{font:inherit;box-sizing:border-box;}button{cursor:pointer;} .fixture-leaf>.view-content { height:100%;box-sizing:border-box; } .hidden{display:none!important;}
</style><style>${css}</style></head><body><div id="app"></div><script src="/fixture.js"></script></body></html>`;
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/fixture.js" ? "text/javascript" : "text/html; charset=utf-8");
  response.end(request.url === "/fixture.js" ? bundle.outputFiles[0].text : html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) }).catch(async error => {
  await new Promise(resolve => server.close(resolve));
  throw error;
});
const report = { engine: await browser.version(), suites: [], layouts: [], errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const page = await context.newPage();
  page.on("pageerror", error => report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => Boolean(window.stability));
  report.suites = await page.evaluate(() => window.stability.run());
  await context.close();
  for (const [width, height, scale, label] of [[360, 760, 1, "phone360"], [390, 844, 1, "phone390"], [430, 932, 1, "phone430"], [390, 420, 1, "keyboard"], [390, 420, 1, "keyboard-filters"], [390, 844, 1, "keyboard-overlay"], [390, 844, 1, "keyboard-overlay-filters"], [390, 844, 1.3, "large-text"], [844, 390, 1, "landscape"], [844, 390, 1, "landscape-filters"], [768, 1024, 1, "tablet"], [1280, 800, 1, "desktop"]]) {
    const mobile = label !== "desktop";
    const layoutContext = await browser.newContext({ viewport: { width, height }, hasTouch: mobile });
    const layoutPage = await layoutContext.newPage();
    layoutPage.on("pageerror", error => report.errors.push(error.message));
    await layoutPage.goto(`http://127.0.0.1:${server.address().port}/`);
    await layoutPage.waitForFunction(() => Boolean(window.stability));
    await layoutPage.evaluate(async ({ scale, mobile, overlay }) => {
      if (overlay) Object.defineProperty(window.visualViewport, "height", { value: 420, configurable: true });
      window.stability.setMobile(mobile);
      document.documentElement.style.setProperty("--yh-font-base", `${16 * scale}px`);
      document.documentElement.style.setProperty("--yh-font-sm", `${14 * scale}px`);
      document.documentElement.style.setProperty("--font-preferred-size", `${16 * scale}px`);
      await window.stability.mountSidebar();
    }, { scale, mobile, overlay: label.startsWith("keyboard-overlay") });
    if (label.endsWith("-filters")) await layoutPage.getByRole("button", { name: "展开或收起筛选" }).click();
    const layout = await layoutPage.evaluate(() => {
      const root = document.querySelector(".yh-overview");
      const list = root.querySelector(".yh-ov-list");
      const tags = root.querySelector(".yh-ov-tag-filter");
      const footer = root.querySelector(".yh-ov-foot");
      const buttons = [...root.querySelectorAll(".yh-ov-btn,.yh-ov-pagination button,.yh-icon-btn")].filter(element => element.getBoundingClientRect().height > 0);
      return { bodyOverflow: document.documentElement.scrollWidth > innerWidth, tagTop: tags.getBoundingClientRect().top, tagBottom: tags.getBoundingClientRect().bottom, listHeight: list.getBoundingClientRect().height, footerBottom: footer.getBoundingClientRect().bottom, minButtonHeight: Math.min(...buttons.map(element => element.getBoundingClientRect().height)), cards: root.querySelectorAll(".yh-ov-card").length };
    });
    const visibleHeight = label.startsWith("keyboard-overlay") ? 420 : height;
    const passed = !layout.bodyOverflow && layout.tagTop >= 0 && layout.tagBottom < visibleHeight && layout.listHeight >= 60 && layout.footerBottom <= visibleHeight + 1 && layout.minButtonHeight >= (mobile ? 44 : 20) && layout.cards === 40;
    report.layouts.push({ label, width, height, passed, ...layout });
    await layoutPage.screenshot({ path: path.join(output, `${label}.png`) });
    await layoutContext.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
await writeFile(path.join(output, "stability-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.errors.length || report.suites.results.some(result => !result.passed) || report.layouts.some(layout => !layout.passed)) process.exitCode = 1;
