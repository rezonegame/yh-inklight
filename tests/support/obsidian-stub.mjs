export class TFile {}
export class TFolder {}

export class FileView {
  constructor(leaf) {
    this.containerEl = leaf.containerEl;
    this.app = leaf.app ?? {};
  }
}

export class Modal {}
export class Setting {}
export const Platform = { isMobile: false };
export function setIcon() {}

export class Notice {
  constructor(message) {
    this.message = String(message);
  }
}

export function normalizePath(value) {
  return String(value).replaceAll("\\\\", "/").replace(/\/+/g, "/").replace(/^\//, "");
}

export function parseYaml(value) {
  const result = {};
  for (const line of String(value).split(/\r?\n/)) {
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const raw = match[2];
    try {
      result[match[1]] = JSON.parse(raw);
    } catch {
      result[match[1]] = raw;
    }
  }
  return result;
}
