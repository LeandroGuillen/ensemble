import {
  flattenOutline,
  focusTargetAtLine,
  formatPovLine,
  headingTrail,
  lineMarkers,
  manuscriptChapterCode,
  parseBookPlan,
  planFocusTargets,
} from './book-plan.utils';

const PLAN = [
  '# Setup',                                    // 0
  '## Valedín',                                 // 1
  '- Quiere salvar a su familia',               // 2
  '# Fase 1: El Prodigio',                      // 3
  'Los tres protagonistas son presentados.',    // 4
  '## 2010 - Llegando (T)',                     // 5
  'PoV: terom-id Terom Bardez',                 // 6
  '- Lugar: el camino',                         // 7
  '- Información oculta aquí:',                 // 8
  '\t- Terom sospecha del Toque',               // 9
  '\t- Alidia miente',                          // 10
  '- Terom añora la playa.',                    // 11
  '## 2180 - Paseo por Nueva Alascar (D o R)',  // 12
  '### 1. Escapada',                            // 13
  '- TODO: decidir la ruta',                    // 14
  '```',                                        // 15
  '## not a heading',                           // 16
  '```',                                        // 17
  '#### Detalle',                               // 18
  '- RE-LECTURA: se ruboriza. OJO continuidad', // 19
  '# Fase 2',                                   // 20
].join('\n');

describe('parseBookPlan', () => {
  const plan = parseBookPlan(PLAN);

  it('builds an outline of sections, chapters and scenes', () => {
    expect(plan.outline.map((h) => h.title)).toEqual(['Setup', 'Fase 1: El Prodigio', 'Fase 2']);
    expect(plan.outline[0].children.map((h) => [h.kind, h.title])).toEqual([['section', 'Valedín']]);

    const [llegando, paseo] = plan.outline[1].children;
    expect([llegando.kind, llegando.code, llegando.title]).toEqual(['chapter', '2010', 'Llegando']);
    expect(llegando.heading).toBe('2010 - Llegando (T)');
    expect([paseo.code, paseo.title]).toEqual(['2180', 'Paseo por Nueva Alascar']);
    expect(paseo.children.map((h) => [h.kind, h.title])).toEqual([['scene', '1. Escapada']]);
    expect(plan.chapters.map((h) => h.code)).toEqual(['2010', '2180']);
  });

  it('reads PoV lines below a chapter heading and leaves them out of the line index', () => {
    const povLine = 'PoV: terom-id Terom Bardez';
    expect(plan.chapters[0].pov).toEqual([
      { characterId: 'terom-id', name: 'Terom Bardez', line: 6, from: PLAN.indexOf(povLine), to: PLAN.indexOf(povLine) + povLine.length },
    ]);
    expect(plan.chapters[1].pov).toEqual([]);
    expect(plan.lines.some((l) => l.text.startsWith('PoV:'))).toBeFalse();
  });

  it('records line and character ranges ending at the next heading of the same level', () => {
    const llegando = plan.chapters[0];
    expect([llegando.line, llegando.endLine]).toEqual([5, 12]);
    expect(PLAN.slice(llegando.from, llegando.to).split('\n')[0]).toBe('## 2010 - Llegando (T)');
    expect(PLAN.slice(llegando.from, llegando.to).endsWith('- Terom añora la playa.\n')).toBeTrue();

    const last = plan.outline[2];
    expect([last.endLine, last.to]).toEqual([21, PLAN.length]);
  });

  it('ignores headings inside code fences and keeps level 4+ headings as content', () => {
    const paseo = plan.chapters[1];
    expect(paseo.children.length).toBe(1);
    expect(paseo.endLine).toBe(20);
    expect(plan.lines.find((l) => l.line === 18)?.text).toBe('#### Detalle');
  });

  it('counts markers per heading, with nested items inheriting "información oculta"', () => {
    expect(plan.chapters[0].markers).toEqual({ lugar: 1, oculto: 3 });
    expect(plan.lines.find((l) => l.line === 11)?.markers).toEqual([]);
    expect(plan.chapters[1].markers).toEqual({ todo: 1, relectura: 1, ojo: 1 });
    expect(plan.outline[1].markers).toEqual({ lugar: 1, oculto: 3, todo: 1, relectura: 1, ojo: 1 });
  });

  it('indexes lines with their chapter and heading', () => {
    expect(plan.lines.find((l) => l.line === 14)).toEqual({
      line: 14,
      text: 'TODO: decidir la ruta',
      chapterCode: '2180',
      headingTitle: '1. Escapada',
      markers: ['todo'],
    });
    expect(plan.lines.find((l) => l.line === 4)?.chapterCode).toBeUndefined();
  });

  it('skips YAML frontmatter', () => {
    const parsed = parseBookPlan('---\ntitle: x\n---\n# A\n- b');
    expect(parsed.outline.map((h) => h.line)).toEqual([3]);
    expect(parsed.lines.map((l) => l.text)).toEqual(['b']);
  });
});

describe('formatPovLine', () => {
  it('writes id and name', () => {
    expect(formatPovLine('abc', 'Reúl Bardez')).toBe('PoV: abc Reúl Bardez');
    expect(formatPovLine('abc', '')).toBe('PoV: abc');
  });
});

describe('lineMarkers', () => {
  it('matches markers as whole words', () => {
    expect(lineMarkers('- TODO — poder de Ceyda')).toEqual(['todo']);
    expect(lineMarkers('- todos los candidatos')).toEqual([]);
    expect(lineMarkers('- Objetivo principal: x')).toEqual(['objetivo']);
    expect(lineMarkers('- un ojo de cristal')).toEqual([]);
  });
});

describe('manuscriptChapterCode', () => {
  it('reads the leading code of chapter files', () => {
    expect(manuscriptChapterCode('content/2180-paseo.typ')).toBe('2180');
    expect(manuscriptChapterCode('2103_el-plan.md')).toBe('2103');
    expect(manuscriptChapterCode('master.typ')).toBeNull();
    expect(manuscriptChapterCode('20100.typ')).toBe('20100');
  });
});

describe('plan navigation helpers', () => {
  const plan = parseBookPlan(PLAN);

  it('splits the plan into focus targets: section intros and level-2 headings', () => {
    const targets = planFocusTargets(plan);
    expect(targets.map((t) => t.heading.title)).toEqual([
      'Setup', 'Valedín', 'Fase 1: El Prodigio', 'Llegando', 'Paseo por Nueva Alascar', 'Fase 2',
    ]);
    const fase1 = targets[2];
    expect(PLAN.slice(fase1.from, fase1.to)).toBe('# Fase 1: El Prodigio\nLos tres protagonistas son presentados.\n');
  });

  it('finds the focus target for a line', () => {
    const targets = planFocusTargets(plan);
    expect(focusTargetAtLine(targets, 4)?.heading.title).toBe('Fase 1: El Prodigio');
    expect(focusTargetAtLine(targets, 14)?.heading.code).toBe('2180');
    expect(focusTargetAtLine(planFocusTargets(parseBookPlan('intro\n# A')), 0)).toBeNull();
  });

  it('builds the heading trail for a line', () => {
    expect(headingTrail(plan, 14).map((h) => h.title)).toEqual([
      'Fase 1: El Prodigio', 'Paseo por Nueva Alascar', '1. Escapada',
    ]);
    expect(headingTrail(plan, 4).map((h) => h.title)).toEqual(['Fase 1: El Prodigio']);
  });

  it('flattens the outline in document order', () => {
    expect(flattenOutline(plan).map((h) => h.line)).toEqual([0, 1, 3, 5, 12, 13, 20]);
  });
});
