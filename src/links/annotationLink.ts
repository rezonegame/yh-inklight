export interface AnnotationLinkParams {
  file: string;
  id: string;
}

export function createAnnotationUri(filePath: string, annotationId: string): string {
  return `obsidian://inklight?file=${encodeURIComponent(filePath)}&id=${encodeURIComponent(annotationId)}`;
}

export function readProtocolParam(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
