/**
 * Minimal stand-in for the `obsidian` module, used ONLY by the unit-test build
 * (scripts/test.mjs). The real `obsidian` package ships type definitions only
 * (no runtime `main`), so esbuild cannot bundle it for Node. This shim provides
 * just enough surface for the test graph (i18n + annotation-link service).
 */

// i18n reads the active locale through moment.locale(). Default to English so
// that locale-independent test assertions (assert.equal(t("x"), t("x"))) hold.
export const moment = {
  locale: (): string => "en",
} as unknown as typeof import("obsidian").moment;

export class App {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(..._args: unknown[]) {}
}

export class Notice {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(..._args: unknown[]) {}
}

export class TFile {
  path = "";
  name = "";
  basename = "";
  extension = "";
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}
