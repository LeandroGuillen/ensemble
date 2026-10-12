import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { BackstageService } from './backstage.service';

describe('BackstageService name list descriptions', () => {
  let service: BackstageService;
  let electron: { writeFileAtomic: jasmine.Spy };

  beforeEach(() => {
    electron = { writeFileAtomic: jasmine.createSpy().and.resolveTo({ success: true }) };
    service = TestBed.runInInjectionContext(() => new BackstageService(
      electron as any,
      { currentProject$: of(null), getNamesFilePath: () => '/project/names.md' } as any,
      { error: jasmine.createSpy() } as any,
    ));
  });

  it('loads plain paragraphs before names and preserves individual notes', () => {
    const lists = (service as any).parseNameListsMarkdown(
      '## Coastal names\n\nNames from the coast.\nA second line.\n\nAnother paragraph.\n\n- Mira\n\t- A sailor\n- Tavi\n',
    );

    expect(lists).toEqual([{
      title: 'Coastal names',
      description: 'Names from the coast.\nA second line.\n\nAnother paragraph.',
      names: [{ name: 'Mira', notes: '\tA sailor' }, { name: 'Tavi', notes: undefined }],
    }]);
  });

  it('keeps lists without descriptions compatible with both heading formats', () => {
    for (const heading of ['#', '##']) {
      const lists = (service as any).parseNameListsMarkdown(`${heading} Original\n\n- Mira\n`);
      expect(lists[0].title).toBe('Original');
      expect(lists[0].description).toBeUndefined();
      expect(lists[0].names[0].name).toBe('Mira');
    }
  });

  it('saves and reloads descriptions as paragraphs through creation and updates', async () => {
    await service.addNameList({
      title: 'Coastal names', description: 'Names from the coast.',
      names: [{ name: 'Mira', notes: '\tA sailor' }],
    });
    await service.addNameList({ title: 'Unused ideas', description: 'Still collecting.', names: [] });
    await service.updateNameList(0, { description: 'Coastal families.\n\nPassed down through generations.' });

    const content = electron.writeFileAtomic.calls.mostRecent().args[1];
    expect(content).toContain('## Coastal names\n\nCoastal families.\n\nPassed down through generations.\n\n- Mira\n\t- A sailor');
    expect((service as any).parseNameListsMarkdown(content)).toEqual(service.getNameLists());
  });

  it('removes the description without changing the names', async () => {
    await service.addNameList({ title: 'Coastal names', description: 'Temporary.', names: [{ name: 'Mira' }] });
    await service.updateNameList(0, { description: undefined });
    const content = electron.writeFileAtomic.calls.mostRecent().args[1];
    expect(content).toBe('## Coastal names\n\n- Mira\n');
    expect((service as any).parseNameListsMarkdown(content)[0].description).toBeUndefined();
  });
});
