import { StateField } from "@codemirror/state";
export const editorInfoField = StateField.define({ create: () => ({ file: null }), update: value => value });
export class TFile {}
export class TFolder {}

export class FileView {
  constructor(leaf) {
    this.leaf = leaf;
    this.containerEl = leaf.containerEl;
    this.app = leaf.app ?? {};
  }
}

export class Component {
  cleanups = [];
  register(cleanup) { this.cleanups.push(cleanup); }
  registerEvent(cleanup) { if (typeof cleanup === "function") this.register(cleanup); }
  registerDomEvent(target, event, callback, options) {
    target.addEventListener(event, callback, options);
    this.register(() => target.removeEventListener(event, callback, options));
  }
  unload() { for (const cleanup of this.cleanups.splice(0).reverse()) cleanup(); }
}
export class MarkdownRenderChild extends Component { constructor(containerEl) { super(); this.containerEl = containerEl; } }
export class ItemView extends FileView {
  cleanups = [];
  children = new Set();
  registerEvent(cleanup) { if (typeof cleanup === "function") this.cleanups.push(cleanup); }
  register(cleanup) { this.cleanups.push(cleanup); }
  addChild(child) { this.children.add(child); return child; }
  removeChild(child) { this.children.delete(child); child.unload(); return child; }
}
export class MarkdownView extends FileView {}
export class Menu {}
export const MarkdownRenderer = { async render(_app, markdown, target) { target.textContent = markdown; } };

export class Modal {}
export class Setting {}
export const Platform = { isMobile: false };
export function setIcon(target, icon) {
  if (typeof document === "undefined" || !target?.replaceChildren) return;
  const label = document.createElement("span");
  label.textContent = ({ "chevron-left": "<", "chevron-right": ">", filter: "=", x: "x" })[icon] ?? "+";
  label.setAttribute("aria-hidden", "true");
  target.replaceChildren(label);
}

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
