/** Empty uses the legacy location; "/" explicitly selects the vault root. */
export function normalizeExportFolder(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim().replace(/\\/g, "/");
  if (!path || value.trim() === "/") return path;
  if (path.startsWith("/") || /[\x00-\x1f:*?"<>|]/.test(path)) return null;
  const parts = path.replace(/\/+$/, "").split("/");
  if (parts.some(part => !part || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return null;
  return parts.join("/");
}
