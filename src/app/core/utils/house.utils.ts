import { HouseFormData } from '../interfaces/house.interface';
import { generateId } from './id.utils';

function strings(value: unknown, deduplicate = true): string[] {
  if (!Array.isArray(value)) return [];
  const result = value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean);
  return deduplicate ? [...new Set(result)] : result;
}
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Preserve leadership array order and dangling references in historical records. */
export function normalizeHouseData(raw: Record<string, unknown>, content: string): HouseFormData {
  const seen = new Set<string>();
  const leadership = (Array.isArray(raw['leadership']) ? raw['leadership'] : []).map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid leadership entry');
    const entry = value as Record<string, unknown>;
    let id = text(entry['id']);
    if (!id || seen.has(id)) id = generateId();
    seen.add(id);
    return { id, characterIds: strings(entry['characterIds']), period: text(entry['period']), books: strings(entry['books']), notes: text(entry['notes']) };
  });
  const data: HouseFormData = {
    name: text(raw['name']), motto: text(raw['motto']), colors: strings(raw['colors'], false),
    thumbnail: text(raw['thumbnail']) || undefined, seatId: text(raw['seatId']) || undefined,
    characterIds: strings(raw['characterIds']), leadership,
    currentLeadershipId: text(raw['currentLeadershipId']) || undefined, content,
  };
  validateHouseData(data);
  return data;
}

export function validateHouseData(data: HouseFormData): void {
  if (!data.name.trim()) throw new Error('House name is required.');
  if (data.colors.some(color => !/^#[0-9a-f]{6}$/i.test(color))) throw new Error('House colors must be six-digit hex colors.');
  const ids = new Set<string>();
  for (const entry of data.leadership) {
    if (!entry.id || ids.has(entry.id)) throw new Error('Leadership entries need unique IDs.');
    ids.add(entry.id);
    if (!entry.characterIds.length) throw new Error('Choose at least one head for each leadership entry.');
  }
  if (data.currentLeadershipId && !ids.has(data.currentLeadershipId)) throw new Error('The current head must reference a leadership entry.');
}
