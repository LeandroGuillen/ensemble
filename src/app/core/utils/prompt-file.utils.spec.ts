import {
  parsePromptBody,
  parsePromptFile,
  promptCoverImage,
  promptVariants,
  sectionsFromCharacterPrompts,
  serializePromptBody,
  serializePromptFile,
} from './prompt-file.utils';

describe('prompt-file.utils', () => {
  const sample = [
    '---',
    'characters:',
    '  - m0k3r5abc123',
    'tags: [pony]',
    'seed: 4160514817',
    '---',
    '',
    'Base look for Dessir.',
    '',
    '```prompt',
    '1woman, solo, score_9, (long blonde braids)+, {sad|happy}',
    '```',
    '```negative',
    'child',
    '```',
    '![[img/dessir/a.png]] ![[img/dessir/b.png|300]]',
    '',
    '## with clothes',
    '',
    '```prompt',
    '1woman, white buttoned shirt',
    '```',
    '![[img/dessir/c.png]]',
    '',
  ].join('\n');

  it('parses frontmatter, main section and variants', () => {
    const data = parsePromptFile(sample);
    expect(data.characters).toEqual(['m0k3r5abc123']);
    expect(data.tags).toEqual(['pony']);
    expect(data.extra).toEqual({ seed: 4160514817 });
    expect(data.sections.length).toBe(2);

    const [main, clothes] = data.sections;
    expect(main.name).toBe('');
    expect(main.notes).toBe('Base look for Dessir.');
    expect(main.prompt).toBe('1woman, solo, score_9, (long blonde braids)+, {sad|happy}');
    expect(main.negative).toBe('child');
    expect(main.images).toEqual(['img/dessir/a.png', 'img/dessir/b.png']);

    expect(clothes.name).toBe('with clothes');
    expect(clothes.prompt).toBe('1woman, white buttoned shirt');
    expect(clothes.negative).toBeNull();
    expect(clothes.images).toEqual(['img/dessir/c.png']);
  });

  it('round-trips through serialize and parse', () => {
    const data = parsePromptFile(sample);
    const again = parsePromptFile(serializePromptFile(data));
    expect(again).toEqual(data);
  });

  const section = (name: string, notes: string, prompt: string | null = null) => ({
    name,
    notes,
    prompt,
    negative: null as string | null,
    images: [] as string[],
  });
  const fileWith = (sections: ReturnType<typeof section>[]) => ({
    characters: [],
    locations: [],
    tags: [],
    created: '2026-11-08T10:00:00Z',
    modified: '2026-11-08T10:00:00Z',
    extra: {},
    sections,
  });

  it('round-trips notes that contain ## heading lines without creating variants', () => {
    const data = fileWith([
      section('', 'Lighting notes for the keeper.\n\n## Golden hour\nWarm rim light from the lantern.'),
      section('Keeper portrait', '##\n## Closed ##\n\\## already escaped\n\\\\## twice', 'keeper, lantern'),
      section('Other', '```text\n## inside a fence\n```\n### deeper\n ## indented'),
    ]);
    const raw = serializePromptFile(data);
    expect(raw).toContain('\\## Golden hour');
    expect(raw).toContain('\n## inside a fence\n');
    expect(parsePromptFile(raw)).toEqual(data);
  });

  it('round-trips main notes that start with an indented ## line (space or tab)', () => {
    for (const notes of [
      ' ## Golden hour\nWarm rim light from the lantern.',
      '\t## Golden hour\nWarm rim light.',
      '   ##Golden hour',
      '    ```prompt\n    indented code\n    ```',
      '  plain indented first line',
    ]) {
      const data = fileWith([section('', notes, 'main prompt'), section('Keeper portrait', 'Variant notes.', 'keeper')]);
      const again = parsePromptFile(serializePromptFile(data));
      expect(again.sections.map((s) => s.name)).withContext(notes).toEqual(['', 'Keeper portrait']);
      expect(again.sections[0].notes).withContext(notes).toBe(notes);
      expect(again.sections[0].prompt).withContext(notes).toBe('main prompt');
      expect(again).withContext(notes).toEqual(data);
    }
  });

  it('reproduces the review probe: indented ## notes in the sample keep notes and prompt in the main section', () => {
    const data = parsePromptFile(sample);
    data.sections[0].notes = '  ## Golden hour\nBase look for Dessir.';
    const again = parsePromptFile(serializePromptFile(data));
    expect(again.sections.length).toBe(2);
    expect(again.sections[0].notes).toBe('  ## Golden hour\nBase look for Dessir.');
    expect(again.sections[0].prompt).toBe(data.sections[0].prompt);
    expect(again).toEqual(data);
  });

  it('still reads a hand-written variant right after the frontmatter (with or without CRLF)', () => {
    for (const eol of ['\n', '\r\n']) {
      const raw = ['---', 'tags: [pony]', '---', '', '', '## First', '```prompt', 'a', '```', ''].join(eol);
      const sections = parsePromptFile(raw).sections;
      expect(sections.map((s) => s.name)).toEqual(['', 'First']);
      expect(sections[1].prompt).toBe('a');
    }
  });

  it('reproduces the review probe: notes with an unclosed fence and a ## line keep the main prompt', () => {
    for (const notes of [
      '```\n## Golden hour',
      'Lighting notes.\n```\n## Golden hour\nWarm rim light.',
      '~~~text\n## Golden hour',
      '```prompt\nnot the prompt\n```',
      '```negative\nnot the negative\n```',
      '````\n```\n## Golden hour',
    ]) {
      const data = fileWith([section('', notes, 'main prompt'), section('Keeper portrait', 'Variant notes.', 'keeper')]);
      const again = parsePromptFile(serializePromptFile(data));
      expect(again.sections.map((s) => s.name)).withContext(notes).toEqual(['', 'Keeper portrait']);
      expect(again.sections[0].prompt).withContext(notes).toBe('main prompt');
      expect(again.sections[0].notes).withContext(notes).toBe(notes);
      expect(again).withContext(notes).toEqual(data);
    }
  });

  it('round-trips leading and trailing blank lines in notes', () => {
    for (const notes of ['\nLighting notes.', 'Lighting notes.\n', '\n\nA\n\nB\n\n', '  \nA\n\t', '\n', '   ', '\\\nA\n\\']) {
      const data = fileWith([section('', notes, 'main prompt'), section('Keeper portrait', notes)]);
      const again = parsePromptFile(serializePromptFile(data));
      expect(again.sections.map((s) => s.notes)).withContext(JSON.stringify(notes)).toEqual([notes, notes]);
      expect(again).withContext(JSON.stringify(notes)).toEqual(data);
    }
  });

  it('round-trips every combination of tricky notes lines', () => {
    const tricky = [
      '',
      '  ',
      '## Golden hour',
      '\\## escaped',
      '\\',
      '```',
      '```prompt',
      '~~~negative',
      '```text',
      '![[img/a.png]]',
      '\\![[img/b.png]]',
      ' ## indented',
      'plain text',
    ];
    for (const a of tricky) {
      for (const b of tricky) {
        for (const c of tricky) {
          const notes = [a, b, c].join('\n');
          const data = fileWith([
            section('', notes, 'main prompt'),
            { ...section('Keeper portrait C#', notes, 'keeper'), negative: 'bad', images: ['img/k.png'] },
            section('Notes only', notes),
          ]);
          const again = parsePromptFile(serializePromptFile(data));
          expect(again).withContext(JSON.stringify(notes)).toEqual(data);
        }
      }
    }
  });

  it('round-trips variant names that start or end with #', () => {
    const names = ['Keeper portrait C#', 'C##', '#1 pick', '# tagged #', '#', '##', 'a #'];
    const data = fileWith([section('', 'Main notes.'), ...names.map((name) => section(name, '', 'x'))]);
    const raw = serializePromptFile(data);
    expect(raw).toContain('## Keeper portrait C# #');
    const again = parsePromptFile(raw);
    expect(again.sections.map((s) => s.name)).toEqual(['', ...names]);
    expect(again).toEqual(data);
  });

  it('reproduces the review probe: a variant name with leading and trailing spaces reopens as typed', () => {
    const data = parsePromptFile(sample);
    data.sections[1].name = ' Keeper portrait C# ';
    const raw = serializePromptFile(data);
    const again = parsePromptFile(raw);
    expect(again.sections.map((s) => s.name)).toEqual(['', ' Keeper portrait C# ']);
    expect(again).toEqual(data);
    // A second save writes the same file.
    expect(serializePromptFile(again)).toBe(raw);
  });

  it('round-trips variant names with surrounding whitespace or character-reference look-alikes', () => {
    const names = [
      '  two spaces  ',
      '\tTabbed\t',
      ' ',
      '   ',
      '\u00a0nbsp\u3000',
      ' C## ',
      ' ## ',
      'x ',
      ' x',
      '&#32;literal&#32;',
      '&amp;#32;x&amp;amp;#9;',
      ' &#32; ',
      '&#32;',
      '&#65;B&#66;',
      'Fish &amp; chips',
      'Tom & Jerry',
      '&',
      '&#;',
    ];
    const data = fileWith([section('', 'Main notes.'), ...names.map((name) => section(name, '', 'x'))]);
    const again = parsePromptFile(serializePromptFile(data));
    expect(again.sections.map((s) => s.name)).toEqual(['', ...names]);
    expect(again).toEqual(data);
  });

  it('round-trips every short name built from tricky pieces', () => {
    const pieces = ['', ' ', '\t', '#', '&#32;', '&amp;', 'a', ';'];
    const names: string[] = [];
    for (const a of pieces) for (const b of pieces) for (const c of pieces) names.push(a + b + c);
    const unique = [...new Set(names)].filter((name) => name !== '');
    const data = fileWith([section('', ''), ...unique.map((name) => section(name, '', 'x'))]);
    const again = parsePromptFile(serializePromptFile(data));
    expect(again.sections.map((s) => s.name)).toEqual(['', ...unique]);
  });

  it('still reads hand-written variant names with & as written', () => {
    const body = ['## Fish &amp; chips', '## Tom & Jerry', '## &#65;bc', ''].join('\n');
    expect(parsePromptBody(body).map((s) => s.name)).toEqual(['', 'Fish &amp; chips', 'Tom & Jerry', '&#65;bc']);
  });

  it('reproduces the card: Golden hour notes and a "C#" variant survive a save and reload', () => {
    const data = parsePromptFile(sample);
    data.sections[0].notes = 'Lighting notes for the keeper.\n\n## Golden hour\nWarm rim light from the lantern.';
    data.sections[1].name = 'Keeper portrait C#';
    const again = parsePromptFile(serializePromptFile(data));
    expect(again.sections.map((s) => s.name)).toEqual(['', 'Keeper portrait C#']);
    expect(again.sections[0].notes).toBe(data.sections[0].notes);
    expect(again).toEqual(data);
  });

  it('still reads hand-written ## variants and closing sequences the same way', () => {
    const body = ['Intro', '', '## First', '```prompt', 'a', '```', '##Second ##', '## Third #  ', '##', ''].join(
      '\n'
    );
    const sections = parsePromptBody(body);
    expect(sections.map((s) => s.name)).toEqual(['', 'First', 'Second', 'Third', '']);
    expect(sections[0].notes).toBe('Intro');
    expect(sections[1].prompt).toBe('a');
  });

  it('keeps other code blocks and deeper headings as notes', () => {
    const body = ['### Settings', '```json', '{"steps": 30}', '```', '## v2', '```prompt', 'x', '```'].join('\n');
    const sections = parsePromptBody(body);
    expect(sections[0].notes).toBe('### Settings\n```json\n{"steps": 30}\n```');
    expect(sections[0].prompt).toBeNull();
    expect(sections[1].name).toBe('v2');
    expect(sections[1].prompt).toBe('x');
  });

  it('does not treat ## inside a fence as a heading', () => {
    const sections = parsePromptBody('```prompt\n## not a heading\n```');
    expect(sections.length).toBe(1);
    expect(sections[0].prompt).toBe('## not a heading');
  });

  it('keeps an unterminated fence as notes', () => {
    const sections = parsePromptBody('```prompt\nhalf written');
    expect(sections[0].prompt).toBeNull();
    expect(sections[0].notes).toBe('```prompt\nhalf written');
  });

  it('uses a longer fence when the prompt contains backticks', () => {
    const body = serializePromptBody([
      { name: '', notes: '', prompt: 'Use ``` to fence code', negative: null, images: [] },
    ]);
    expect(body).toContain('````prompt');
    expect(parsePromptBody(body)[0].prompt).toBe('Use ``` to fence code');
  });

  it('treats a plain text file as notes only', () => {
    const data = parsePromptFile('Just some text\n');
    expect(data.sections.length).toBe(1);
    expect(data.sections[0].notes).toBe('Just some text');
    expect(promptVariants(data)).toEqual([]);
  });

  it('finds the cover image and the variants', () => {
    const data = parsePromptFile(sample);
    expect(promptCoverImage(data)).toBe('img/dessir/a.png');
    expect(promptVariants(data).map((s) => s.name)).toEqual(['', 'with clothes']);
  });

  it('converts legacy character prompts into sections', () => {
    const unnamedFirst = sectionsFromCharacterPrompts([
      { name: '', positive: 'a', negative: 'child' },
      { name: 'with clothes', positive: 'b', negative: '' },
    ]);
    expect(unnamedFirst.map((s) => [s.name, s.prompt, s.negative])).toEqual([
      ['', 'a', 'child'],
      ['with clothes', 'b', null],
    ]);

    const namedFirst = sectionsFromCharacterPrompts([{ name: 'base', positive: 'a', negative: '' }]);
    expect(namedFirst.map((s) => [s.name, s.prompt])).toEqual([
      ['', null],
      ['base', 'a'],
    ]);
  });
});
