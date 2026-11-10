import { CharacterLife, CharacterResidence } from '../interfaces/character.interface';

/**
 * Frontmatter dates for timelines (`born:`, `died:`, `residence[].from`) are kept as written
 * (`312`, `322-05`, `c. 1`). YAML turns bare numbers into numbers and 4-digit ISO dates into
 * Dates, so both are converted back to the written form.
 */
export function normalizeLifeDate(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

/** `residence:` list of `{ from, place, note? }` (place is a location id); invalid rows are dropped. */
export function normalizeResidence(value: unknown): CharacterResidence[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => {
      const from = normalizeLifeDate(row['from']);
      const place = typeof row['place'] === 'string' ? row['place'].trim() : '';
      const note = typeof row['note'] === 'string' ? row['note'].trim() : '';
      return from && place ? { from, place, ...(note ? { note } : {}) } : null;
    })
    .filter((row): row is CharacterResidence => row !== null);
  return rows.length ? rows : undefined;
}

/** Normalized timeline fields; absent keys stay absent. */
export function lifeFields(born: unknown, died: unknown, residence: unknown): CharacterLife {
  const b = normalizeLifeDate(born);
  const d = normalizeLifeDate(died);
  const r = normalizeResidence(residence);
  return { ...(b ? { born: b } : {}), ...(d ? { died: d } : {}), ...(r ? { residence: r } : {}) };
}

/** Plain years are written as YAML numbers (`born: 312`, not `born: '312'`). */
export function yamlDate(value: string): string | number {
  return /^-?\d{1,6}$/.test(value) ? Number(value) : value;
}

/** Frontmatter keys for a character's timeline fields. */
export function lifeFrontmatter(life: CharacterLife): Record<string, unknown> {
  const fields = lifeFields(life.born, life.died, life.residence);
  return {
    ...(fields.born ? { born: yamlDate(fields.born) } : {}),
    ...(fields.died ? { died: yamlDate(fields.died) } : {}),
    ...(fields.residence
      ? { residence: fields.residence.map((row) => ({ ...row, from: yamlDate(row.from) })) }
      : {}),
  };
}
