import { Character } from '../interfaces/character.interface';

/** Human-readable identity for records that are allowed to have no name while drafting. */
export function getCharacterDisplayName(character: Character): string {
  const name = character.name?.trim();
  if (name) return name;
  const suffix = character.id.slice(-4).toUpperCase();
  return `Unnamed draft${suffix ? ` · ${suffix}` : ''}`;
}

