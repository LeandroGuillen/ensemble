import { Character } from '../interfaces/character.interface';
import { renderWikiLinkMarkdown, resolveWikiLink, WikiLinkCollection } from './wiki-links.utils';

export function resolveCharacterLink(target: string, characters: Character[], charactersFolder = 'characters'): Character | undefined {
  return resolveWikiLink(target, characters, charactersFolder);
}

export function renderCharacterMarkdown(content: string, characters: Character[], charactersFolder = 'characters', otherCollections: WikiLinkCollection[] = []): { html: string; missingLinks: string[] } {
  return renderWikiLinkMarkdown(content, characters, { folder: charactersFolder, route: 'character', singular: 'Character' }, otherCollections);
}
