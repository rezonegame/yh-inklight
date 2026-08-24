/**
 * [INPUT]: 纯标签定义、旧版 title/noteType 与用户设置
 * [OUTPUT]: 标签校验、解析、旧数据映射和显示文本
 * [POS]: Markdown、PDF、EPUB、侧栏与导出共用的语义标签真相源
 */

import { t } from "../i18n";

export interface AnnotationTagDefinition {
  id: string;
  name: string;
  icon: string;
  enabled: boolean;
  builtIn?: boolean;
}

export interface AnnotationTagReference {
  tagId?: string;
  tagLabelSnapshot?: string;
  title?: string;
  noteType?: string;
}

export interface ResolvedAnnotationTag {
  id: string;
  name: string;
  icon: string;
  enabled: boolean;
  unavailable: boolean;
}

export const MAX_ENABLED_ANNOTATION_TAGS = 5;
export const MAX_ANNOTATION_TAG_NAME_LENGTH = 20;

export const TAG_ICON_OPTIONS = [
  { id: "lightbulb", label: t("icon.lightbulb") },
  { id: "circle-help", label: t("icon.help") },
  { id: "bell", label: t("icon.bell") },
  { id: "bookmark", label: t("icon.bookmark") },
  { id: "star", label: t("icon.star") },
  { id: "flag", label: t("icon.flag") },
  { id: "heart", label: t("icon.heart") },
] as const;

export const DEFAULT_ANNOTATION_TAGS: AnnotationTagDefinition[] = [
  { id: "insight", name: "洞见", icon: "lightbulb", enabled: true, builtIn: true },
  { id: "question", name: "疑问", icon: "circle-help", enabled: true, builtIn: true },
  { id: "reminder", name: "提醒", icon: "bell", enabled: true, builtIn: true },
];

const LEGACY_TITLE_TO_TAG_ID: Record<string, string> = {
  insight: "insight",
  question: "question",
  reminder: "reminder",
};

const LEGACY_TITLE_BY_TAG_ID: Record<string, string> = {
  insight: "Insight",
  question: "Question",
  reminder: "Reminder",
};

export function cloneDefaultAnnotationTags(): AnnotationTagDefinition[] {
  return DEFAULT_ANNOTATION_TAGS.map((tag) => ({ ...tag }));
}

export function normalizeTagName(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase();
}

export function normalizeTagLabel(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function isKnownTagIcon(icon: string): boolean {
  return TAG_ICON_OPTIONS.some((option) => option.id === icon);
}

export function enabledAnnotationTags(tags: AnnotationTagDefinition[]): AnnotationTagDefinition[] {
  return tags.filter((tag) => tag.enabled);
}

export function validateAnnotationTags(tags: AnnotationTagDefinition[]): string | null {
  if (!tags.length) {
    return t("tag.atLeastOne");
  }

  const enabledCount = enabledAnnotationTags(tags).length;
  if (enabledCount === 0) {
    return t("tag.atLeastOneEnabled");
  }
  if (enabledCount > MAX_ENABLED_ANNOTATION_TAGS) {
    return t("tag.maxEnabled", { max: MAX_ENABLED_ANNOTATION_TAGS });
  }

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const tag of tags) {
    if (!tag.id.trim()) {
      return t("tag.invalidId");
    }
    if (seenIds.has(tag.id)) {
      return t("tag.duplicateId");
    }
    seenIds.add(tag.id);

    const label = normalizeTagLabel(tag.name);
    if (!label) {
      return t("tag.emptyName");
    }
    if (Array.from(label).length > MAX_ANNOTATION_TAG_NAME_LENGTH) {
      return t("tag.nameTooLong", { max: MAX_ANNOTATION_TAG_NAME_LENGTH });
    }
    const nameKey = normalizeTagName(label);
    if (seenNames.has(nameKey)) {
      return t("tag.duplicateName");
    }
    seenNames.add(nameKey);
    if (!isKnownTagIcon(tag.icon)) {
      return t("tag.invalidIcon");
    }
  }
  return null;
}

export function normalizeAnnotationTags(value: unknown): AnnotationTagDefinition[] {
  if (!Array.isArray(value)) {
    return cloneDefaultAnnotationTags();
  }

  const tags: AnnotationTagDefinition[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const raw = candidate as Partial<AnnotationTagDefinition>;
    if (typeof raw.id !== "string" || typeof raw.name !== "string") {
      continue;
    }
    const name = normalizeTagLabel(raw.name);
    const tag: AnnotationTagDefinition = {
      id: raw.id.trim(),
      name,
      icon: typeof raw.icon === "string" && isKnownTagIcon(raw.icon) ? raw.icon : "bookmark",
      enabled: raw.enabled !== false,
      builtIn: raw.builtIn === true || DEFAULT_ANNOTATION_TAGS.some((defaultTag) => defaultTag.id === raw.id),
    };
    if (tag.id && name) {
      tags.push(tag);
    }
  }

  return validateAnnotationTags(tags) ? cloneDefaultAnnotationTags() : tags;
}

export function createCustomAnnotationTag(id: string): AnnotationTagDefinition {
  return {
    id,
    name: t("tag.newTagName"),
    icon: "bookmark",
    enabled: true,
  };
}

export function resolveAnnotationTag(
  tags: AnnotationTagDefinition[],
  reference: AnnotationTagReference,
): ResolvedAnnotationTag | null {
  const tagId = reference.tagId || legacyTagId(reference.title) || legacyTagId(reference.noteType);
  if (tagId) {
    const configured = tags.find((tag) => tag.id === tagId);
    if (configured) {
      return {
        id: configured.id,
        name: configured.name,
        icon: configured.icon,
        enabled: configured.enabled,
        unavailable: !configured.enabled,
      };
    }
    if (reference.tagLabelSnapshot) {
      return {
        id: tagId,
        name: reference.tagLabelSnapshot,
        icon: "bookmark",
        enabled: false,
        unavailable: true,
      };
    }
  }

  const legacyLabel = reference.title || reference.noteType;
  if (legacyLabel) {
    return {
      id: `legacy:${normalizeTagName(legacyLabel) || "unknown"}`,
      name: legacyLabel,
      icon: "bookmark",
      enabled: false,
      unavailable: true,
    };
  }

  return null;
}

export function legacyTitleForTag(tagId: string): string | undefined {
  return LEGACY_TITLE_BY_TAG_ID[tagId];
}

export function legacyNoteTypeForTag(tagId: string): "insight" | "question" | "reminder" | undefined {
  return tagId === "insight" || tagId === "question" || tagId === "reminder" ? tagId : undefined;
}

export function tagDisplayText(tag: Pick<AnnotationTagDefinition, "name">): string {
  return tag.name;
}

function legacyTagId(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return LEGACY_TITLE_TO_TAG_ID[normalizeTagName(value)];
}
