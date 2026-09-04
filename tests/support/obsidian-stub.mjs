export class TFile {}

export class Notice {
  constructor(message) {
    this.message = String(message);
  }
}

export function normalizePath(value) {
  return String(value).replaceAll("\\\\", "/").replace(/\/+/g, "/").replace(/^\//, "");
}
