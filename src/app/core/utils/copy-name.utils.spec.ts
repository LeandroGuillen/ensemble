import { buildWikiLinkTargets, WikiLinkCollection } from './wiki-links.utils';
import { nextCopyName } from './copy-name.utils';

describe('nextCopyName', () => {
  it('appends (copy), then (copy 2), (copy 3)…', () => {
    expect(nextCopyName('Mara', ['Mara'])).toBe('Mara (copy)');
    expect(nextCopyName('Mara', ['Mara', 'Mara (copy)'])).toBe('Mara (copy 2)');
    expect(nextCopyName('Mara', ['Mara', 'Mara (copy)', 'Mara (copy 2)'])).toBe('Mara (copy 3)');
  });

  it('continues the sequence when duplicating a copy', () => {
    expect(nextCopyName('Mara (copy)', ['Mara', 'Mara (copy)'])).toBe('Mara (copy 2)');
    expect(nextCopyName('Mara (copy 2)', ['Mara', 'Mara (copy)', 'Mara (copy 2)'])).toBe('Mara (copy 3)');
  });

  it('is case-insensitive and also avoids taken wikilink stems', () => {
    expect(nextCopyName('Mara', ['MARA (COPY)'])).toBe('Mara (copy 2)');
    expect(nextCopyName('Mara', ['mara-copy'])).toBe('Mara (copy 2)');
  });

  it('keeps an unnamed draft unnamed', () => {
    expect(nextCopyName('  ', [])).toBe('');
  });
});

describe('wikilinks after a duplicate', () => {
  const characters = (targets: any[]): WikiLinkCollection =>
    ({ targets, folder: 'characters', route: 'character', singular: 'Character' });
  const original = { id: 'orig', name: 'Mara', aliases: ['Dess'], relativePath: 'mara/mara.md' };
  const copy = { id: 'copy', name: 'Mara (copy)', aliases: ['Dess'], relativePath: 'mara-copy/mara-copy.md' };

  it('keeps [[Mara]] on the original and resolves [[Mara (copy)]] to the copy', () => {
    const { resolve } = buildWikiLinkTargets([characters([original, copy])]);
    expect(resolve('Mara')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'orig' }));
    expect(resolve('mara')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'orig' }));
    expect(resolve('Mara (copy)')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'copy' }));
  });

  it("labels the copy's alias suggestion with the copy's name", () => {
    const { suggestions } = buildWikiLinkTargets([characters([original, copy])]);
    const aliases = suggestions.filter((s) => s.label === 'Dess');
    expect(aliases.map((s) => s.detail)).toEqual(['→ Mara', '→ Mara (copy)']);
    expect(aliases.map((s) => s.target)).toEqual(['Mara', 'Mara (copy)']);
  });
});
