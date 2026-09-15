import { pathBasename } from './path.utils';

export const CHARACTER_DRAFTS_FOLDER = '@drafts';

export interface CharacterMainFileLocation {
  draft: boolean;
  folderName: string;
}

/**
 * Recognizes the folder-based character convention:
 *   <slug>/<slug>.md
 *   @drafts/<slug>/<slug>.md
 *
 * Everything else in a character folder is deliberately ignored.
 */
export function parseCharacterMainFileLocation(
  relativePath: string
): CharacterMainFileLocation | null {
  const parts = relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);

  if (parts.length === 2) {
    const [folderName, filename] = parts;
    if (folderName !== CHARACTER_DRAFTS_FOLDER && filename === `${folderName}.md`) {
      return { draft: false, folderName };
    }
  }

  if (parts.length === 3 && parts[0] === CHARACTER_DRAFTS_FOLDER) {
    const folderName = parts[1];
    if (parts[2] === `${folderName}.md`) {
      return { draft: true, folderName };
    }
  }

  return null;
}

/** Transitional support for projects using the former `_name.md` convention. */
export function isLegacyCharacterMainFile(relativePath: string): boolean {
  return /(^|\/)_[^/]+\.md$/i.test(relativePath.replace(/\\/g, '/'));
}

export function isFolderBasedCharacterPath(relativePath: string): boolean {
  return parseCharacterMainFileLocation(relativePath) !== null;
}

export function characterFolderRelativePath(relativePath: string): string | null {
  const location = parseCharacterMainFileLocation(relativePath);
  if (!location) return null;
  return location.draft
    ? `${CHARACTER_DRAFTS_FOLDER}/${location.folderName}`
    : location.folderName;
}

export function characterFolderName(relativePath: string): string | null {
  return parseCharacterMainFileLocation(relativePath)?.folderName ?? null;
}

export function characterMainFilename(relativePath: string): string {
  return pathBasename(relativePath);
}
