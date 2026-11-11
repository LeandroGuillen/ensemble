import { scanPlanCharacterLinks, PlanLinkCharacter } from './plan-character-links.utils';

const mara: PlanLinkCharacter = { id: 'm', name: 'Mara Vell', aliases: ['Mav'], target: 'Mara Vell' };
const ben: PlanLinkCharacter = { id: 'b', name: 'Ben', target: 'Ben' };

describe('scanPlanCharacterLinks', () => {
  it('links full names and aliases, preserving case and whole Unicode words', () => {
    const scan = scanPlanCharacterLinks('Mara Vell greets Mav. mara vell, Mavery, éMav and Mavé stay.', [mara]);
    expect(scan.text).toBe('[[Mara Vell]] greets [[Mara Vell|Mav]]. mara vell, Mavery, éMav and Mavé stay.');
    expect(scan.count).toBe(2);
  });

  it('reports shared names, aliases and first names with chapter, line and candidates', () => {
    const other = { id: 'x', name: 'Mara Stone', aliases: ['Mav', 'Ben'], target: 'characters/x/x' };
    const scan = scanPlanCharacterLinks('## 2180 - Arrival\nMara meets Mav and Ben.', [mara, ben, other]);
    expect(scan.count).toBe(0);
    expect(scan.ambiguous.map(a => a.mention)).toEqual(['Mara', 'Mav', 'Ben']);
    expect(scan.ambiguous[0]).toEqual(jasmine.objectContaining({ chapter: '2180 - Arrival', line: 1, text: 'Mara meets Mav and Ben.', candidates: ['Mara Vell', 'Mara Stone'] }));
  });

  it('leaves existing links, headings, PoV, dates, code, comments, frontmatter and hidden markers alone', () => {
    const text = '---\nname: Ben\n---\n# Ben\n## 2180 - Ben\nPoV: b Ben\nWhen: Ben\nBen\n===\n`Ben` [[Ben]] [[Ben|Ben]] ![[Ben]] [Ben](Ben)\n```md\nBen\n```\n<!-- Ben -->\n%% Ben %%\n- Información oculta aquí:\n  - Ben\n- TODO Ben\nBen';
    const scan = scanPlanCharacterLinks(text, [ben]);
    expect(scan.text).toBe(text.slice(0, -3) + '[[Ben]]');
    expect(scan.count).toBe(1);
  });

  it('reports two characters with identical names as distinct candidates', () => {
    const scan = scanPlanCharacterLinks('Ben', [ben, { ...ben, id: 'other', target: 'characters/other/other' }]);
    expect(scan.text).toBe('Ben');
    expect(scan.ambiguous[0].candidates).toEqual(['Ben (b)', 'Ben (other)']);
  });

  it('inserts path targets for special names and matches punctuation literally', () => {
    const scan = scanPlanCharacterLinks('Unit #7 meets A+B and José.', [
      { id: 'u', name: 'Unit #7', aliases: ['A+B'], target: 'characters/unit/unit' },
      { id: 'j', name: 'José', target: 'José' },
    ]);
    expect(scan.text).toBe('[[characters/unit/unit|Unit #7]] meets [[characters/unit/unit|A+B]] and [[José]].');
    expect(scan.changes.length).toBe(3);
  });

  it('omits common words and leaves location/House collisions for review', () => {
    const characters = [ben, { id: 'w', name: 'Will', target: 'Will' }, { id: 'h', name: 'Rose', target: 'Rose' }];
    const scan = scanPlanCharacterLinks('Ben Will Rose', characters, ['Ben', 'Rose']);
    expect(scan.count).toBe(0);
    expect(scan.ambiguous.length).toBe(1);
    expect(scan.ambiguous[0].reason).toContain('Location or House');

  });

  it('never offers articles, stop words or common words as names, even explicit names or aliases', () => {
    for (const first of ['The', 'A', 'An', 'El', 'La', 'Los', 'Las', 'Un', 'Una', 'De', 'Will', 'Rose']) {
      const name = `${first} Keeper`;
      const scan = scanPlanCharacterLinks(`${first} waits. ${name} arrives.`, [
        { id: 'k', name, aliases: [first], target: name },
        { id: 'word', name: first, target: first },
      ]);
      expect(scan.text).toBe(`${first} waits. [[${name}]] arrives.`);
      expect(scan.ambiguous).toEqual([]);
    }
  });

  it('leaves sentence-initial The alone while linking The Grey Pilot in full', () => {
    const scan = scanPlanCharacterLinks('The tide turns. The Grey Pilot arrives.', [
      { id: 'p', name: 'The Grey Pilot', target: 'The Grey Pilot' },
    ]);
    expect(scan.text).toBe('The tide turns. [[The Grey Pilot]] arrives.');
    expect(scan.ambiguous).toEqual([]);
  });

  it('offers a first name only as an unchecked suggestion with its alias link', () => {
    const scan = scanPlanCharacterLinks('Mara meets Mara Vell.', [mara]);
    expect(scan.count).toBe(1);
    expect(scan.text).toBe('Mara meets [[Mara Vell]].');
    expect(scan.ambiguous).toEqual([jasmine.objectContaining({ mention: 'Mara', selected: false,
      reason: 'Shortened name; confirm the character', change: { from: 0, to: 4, insert: '[[Mara Vell|Mara]]' } })]);
  });

  it('uses canonical targets, chooses the longest name, and is idempotent', () => {
    const characters = [mara, { id: 's', name: 'Mara', target: 'characters/mara/mara' }];
    const scan = scanPlanCharacterLinks('Mara Vell and Mav', characters);
    expect(scan.text).toBe('[[Mara Vell]] and [[Mara Vell|Mav]]');
    expect(scanPlanCharacterLinks(scan.text, characters).count).toBe(0);
  });
});
