import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { WikiLinkRenameService } from './wiki-link-rename.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { ModalService } from './modal.service';
import { WikiLinkTargetsService } from './wiki-link-targets.service';
import { CharacterService } from './character.service';
import { LocationService } from './location.service';
import { HouseService } from './house.service';
import { buildWikiLinkTargets } from '../utils/wiki-links.utils';

describe('WikiLinkRenameService', () => {
  let service: WikiLinkRenameService;
  let electron: jasmine.SpyObj<ElectronService>;
  let modal: jasmine.SpyObj<ModalService>;
  const old = { id: 'dess', name: 'Dess', relativePath: 'dess/dess.md', filePath: '/project/characters/dess/dess.md', content: '' };
  const saved = () => ({ ...old, name: 'Dessir', filePath: '/project/characters/dessir/dessir.md', relativePath: 'dessir/dessir.md' });
  beforeEach(() => {
    electron = jasmine.createSpyObj('ElectronService', ['readDirectoryRecursive', 'readFile', 'rewriteWikiLinks']);
    electron.readDirectoryRecursive.and.resolveTo({ success: true, files: [
      { relativePath: 'characters/other/other.md', absolutePath: '/project/characters/other/other.md' },
      { relativePath: 'characters/dessir/dessir.b1.md', absolutePath: '/project/characters/dessir/dessir.b1.md' },
      { relativePath: '.ensemble-trash/deleted.md', absolutePath: '/project/.ensemble-trash/deleted.md' },
    ] });
    electron.readFile.and.callFake(async path => ({ success: true, content: path === saved().filePath ? '---\nid: dess\nname: Dessir\n---\n\nNotes' : '---\nthumbnail: "[[Dess]]"\n---\n\n[[Dess|the witch]] and [[characters/dess/dess#History]] `[[Dess]]`' }));
    electron.rewriteWikiLinks.and.resolveTo({ success: true });
    modal = jasmine.createSpyObj('ModalService', ['confirmLinkRename', 'confirm']);
    modal.confirmLinkRename.and.resolveTo({ update: true, alias: false });
    modal.confirm.and.resolveTo(true);
    TestBed.configureTestingModule({ providers: [
      { provide: ElectronService, useValue: electron },
      { provide: ProjectService, useValue: { getCurrentProject: () => ({ path: '/project', metadata: { settings: {} } }) } },
      { provide: ModalService, useValue: modal },
      { provide: WikiLinkTargetsService, useValue: { targets$: () => of(buildWikiLinkTargets([{ folder: 'characters', route: 'character', singular: 'Character', targets: [old, { ...saved(), id: 'new' }] }])) } },
      { provide: CharacterService, useValue: { forceReloadCharacters: async () => {} } },
      { provide: LocationService, useValue: { forceReloadLocations: async () => {} } },
      { provide: HouseService, useValue: { loadHouses: async () => {} } },
    ] });
    service = TestBed.inject(WikiLinkRenameService);
  });
  it('previews counts and paths and batches descriptions and moved book pages', async () => {
    await service.run(old, 'Dessir', 'character', async () => saved());
    expect(modal.confirmLinkRename).toHaveBeenCalledWith(jasmine.stringMatching('Update 4 links in 2 files'));
    expect(modal.confirmLinkRename.calls.mostRecent().args[0]).toContain('dessir.b1.md');
    const changes = electron.rewriteWikiLinks.calls.mostRecent().args[0];
    expect(changes.length).toBe(2);
    expect(changes[0].content).toContain('[[characters/dessir/dessir|the witch]]');
    expect(changes[0].content).toContain('thumbnail: "[[Dess]]"');
    expect(changes[0].content).toContain('`[[Dess]]`');
  });
  it('does not prompt or write when no inbound links are found', async () => {
    electron.readFile.and.resolveTo({ success: true, content: 'No links here' });
    await service.run(old, 'Dessir', 'character', async () => saved());
    expect(modal.confirmLinkRename).not.toHaveBeenCalled();
    expect(electron.rewriteWikiLinks).not.toHaveBeenCalled();
  });
  it('saves without scanning when the name is unchanged', async () => {
    const save = jasmine.createSpy('save').and.resolveTo(old);
    await service.run(old, old.name, 'character', save);
    expect(save).toHaveBeenCalledTimes(1);
    expect(electron.readDirectoryRecursive).not.toHaveBeenCalled();
  });
  it('declining performs no link writes', async () => {
    modal.confirmLinkRename.and.resolveTo({ update: false, alias: false });
    await service.run(old, 'Dessir', 'character', async () => saved());
    expect(electron.rewriteWikiLinks).not.toHaveBeenCalled();
  });
  it('adds the old name as an alias in the same batch', async () => {
    modal.confirmLinkRename.and.resolveTo({ update: true, alias: true });
    const result = await service.run(old, 'Dessir', 'character', async () => saved());
    expect((result as { aliases?: string[] }).aliases).toEqual(['Dess']);
    const changes = electron.rewriteWikiLinks.calls.mostRecent().args[0];
    expect(changes.find(change => change.path === saved().filePath)!.content).toContain('aliases:');
  });
  it("adding the old name as alias preserves another record's canonical name links", async () => {
    const canonical = { id: 'canonical', name: 'Dess', relativePath: 'canonical/canonical.md' };
    const collection = (targets: any[]) => buildWikiLinkTargets([{ folder: 'characters', route: 'character', singular: 'Character', targets }]);
    spyOn(TestBed.inject(WikiLinkTargetsService), 'targets$').and.returnValue(of(collection([old, canonical])));
    modal.confirmLinkRename.and.resolveTo({ update: true, alias: true });
    const result = await service.run(old, 'Dessir', 'character', async () => saved());
    const changes = electron.rewriteWikiLinks.calls.mostRecent().args[0];
    expect(changes[0].content).toContain('[[Dess|the witch]]');
    expect(changes[0].content).toContain('[[characters/dessir/dessir#History]]');
    const resolved = collection([result, canonical]).resolve('Dess');
    expect(resolved).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'canonical' }));
    expect((result as { aliases?: string[] }).aliases).toEqual(['Dess']);
  });
  it('leaves links through a surviving alias alone and excludes them from the count', async () => {
    const before = { ...old, aliases: ['The Lamplighter'] };
    const after = { ...saved(), aliases: ['The Lamplighter'] };
    const collection = (targets: any[]) => buildWikiLinkTargets([{ folder: 'characters', route: 'character', singular: 'Character', targets }]);
    const targets$ = spyOn(TestBed.inject(WikiLinkTargetsService), 'targets$');
    targets$.and.returnValues(of(collection([before])), of(collection([after])));
    electron.readDirectoryRecursive.and.resolveTo({ success: true, files: [
      { relativePath: 'characters/oren/oren.md', absolutePath: '/project/characters/oren/oren.md' },
    ] });
    electron.readFile.and.resolveTo({ success: true, content: 'Call her [[The Lamplighter]] or [[The Lamplighter|her]], not [[Dess]].' });
    await service.run(before, 'Dessir', 'character', async () => after);
    expect(modal.confirmLinkRename).toHaveBeenCalledWith(jasmine.stringMatching('Update 1 links in 1 files'));
    expect(electron.rewriteWikiLinks.calls.mostRecent().args[0][0].content)
      .toBe('Call her [[The Lamplighter]] or [[The Lamplighter|her]], not [[Dessir]].');
  });
  it('surfaces batch failure without claiming the alias was saved', async () => {
    modal.confirmLinkRename.and.resolveTo({ update: true, alias: true });
    electron.rewriteWikiLinks.and.resolveTo({ success: false, error: 'changed on disk' });
    const record = saved();
    await expectAsync(service.run(old, 'Dessir', 'character', async () => record)).toBeRejectedWithError('changed on disk');
    expect((record as { aliases?: string[] }).aliases).toBeUndefined();
  });
});

describe('WikiLinkRenameService name conflicts', () => {
  let service: WikiLinkRenameService;
  let electron: jasmine.SpyObj<ElectronService>;
  let modal: jasmine.SpyObj<ModalService>;
  let collections: any[];
  const cases = [
    { folder: 'characters', route: 'character', singular: 'Character', noun: 'character',
      self: { id: 'oren', name: 'Oren Vell', relativePath: 'oren-vell/oren-vell.md', filePath: '/project/characters/oren-vell/oren-vell.md', content: '', aliases: ['Old Oren'] },
      other: { id: 'mara', name: 'Mara Vell', relativePath: 'mara-vell/mara-vell.md', aliases: ['The Lamplighter'] } },
    { folder: 'locations', route: 'location', singular: 'Location', noun: 'location',
      self: { id: 'docks', name: 'Low Docks', relativePath: '_low-docks.md', filePath: '/project/locations/_low-docks.md', content: '', aliases: ['Old Oren'] },
      other: { id: 'mara', name: 'Mara Vell', relativePath: '_mara-vell.md', aliases: ['The Lamplighter'] } },
    { folder: 'houses', route: 'house', singular: 'House', noun: 'House',
      self: { id: 'oren', name: 'House Oren', relativePath: 'house-oren/house-oren.md', filePath: '/project/houses/house-oren/house-oren.md', content: '', aliases: ['Old Oren'] },
      other: { id: 'mara', name: 'Mara Vell', relativePath: 'mara-vell/mara-vell.md', aliases: ['The Lamplighter'] } },
  ];
  const prose = 'See [[The Lamplighter]], [[The Lamplighter#Past|her]] and [[Mara Vell]]. [[Old Oren]]';
  const setup = (c: typeof cases[number]) => {
    collections = [{ folder: c.folder, route: c.route, singular: c.singular, targets: [c.self, c.other] }];
    electron = jasmine.createSpyObj('ElectronService', ['readDirectoryRecursive', 'readFile', 'rewriteWikiLinks']);
    electron.readDirectoryRecursive.and.resolveTo({ success: true, files: [
      { relativePath: 'notes/a.md', absolutePath: '/project/notes/a.md' },
      { relativePath: '.ensemble-trash/x/a.md', absolutePath: '/project/.ensemble-trash/x/a.md' },
    ] });
    electron.readFile.and.resolveTo({ success: true, content: '---\nnote: "[[The Lamplighter]]"\n---\n' + prose });
    electron.rewriteWikiLinks.and.resolveTo({ success: true });
    modal = jasmine.createSpyObj('ModalService', ['confirmLinkRename', 'confirm']);
    modal.confirmLinkRename.and.resolveTo({ update: false, alias: false });
    modal.confirm.and.resolveTo(true);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [
      { provide: ElectronService, useValue: electron },
      { provide: ProjectService, useValue: { getCurrentProject: () => ({ path: '/project', metadata: { settings: {} } }) } },
      { provide: ModalService, useValue: modal },
      { provide: WikiLinkTargetsService, useValue: { targets$: () => of(buildWikiLinkTargets(collections)) } },
      { provide: CharacterService, useValue: { forceReloadCharacters: async () => {} } },
      { provide: LocationService, useValue: { forceReloadLocations: async () => {} } },
      { provide: HouseService, useValue: { loadHouses: async () => {} } },
    ] });
    service = TestBed.inject(WikiLinkRenameService);
  };
  /** Simulates the save: the record now answers to `name` (as the real services do). */
  const saveAs = (c: typeof cases[number], name: string) => jasmine.createSpy('save').and.callFake(async () => {
    const record = { ...c.self, name };
    collections = collections.map((collection, index) => index ? collection : { ...collection, targets: [record, c.other] });
    return record;
  });

  for (const c of cases) {
    describe(c.route, () => {
      beforeEach(() => setup(c));
      it("warns before saving when the new name is another record's alias, naming it and the links that retarget", async () => {
        let warnedBeforeSave = false;
        const save = saveAs(c, 'The Lamplighter');
        await service.run(c.self, 'The Lamplighter', c.route as any, async () => { warnedBeforeSave = modal.confirm.calls.count() === 1; return save(); });
        expect(warnedBeforeSave).toBeTrue();
        expect(modal.confirm).toHaveBeenCalledTimes(1);
        const [message, title, options] = modal.confirm.calls.mostRecent().args;
        expect(title).toBe('Name already in use');
        expect(message).toContain('"The Lamplighter" is an alias of Mara Vell (' + c.singular + ').');
        // Frontmatter and the staged trash don't count; the [[Mara Vell]] name link keeps opening Mara.
        expect(message).toContain(`2 links to Mara Vell will point to this ${c.noun} instead.`);
        expect(options).toEqual(jasmine.objectContaining({ confirmText: 'Rename anyway', cancelText: 'Cancel' }));
      });
      it('continuing saves and links through the alias open the renamed record, as before', async () => {
        const save = saveAs(c, 'The Lamplighter');
        await service.run(c.self, 'The Lamplighter', c.route as any, save);
        expect(save).toHaveBeenCalledTimes(1);
        expect(buildWikiLinkTargets(collections).resolve('The Lamplighter')).toEqual(jasmine.objectContaining({ state: 'resolved', id: c.self.id }));
      });
      it('cancel saves nothing, writes nothing and leaves link resolution as it was', async () => {
        modal.confirm.and.resolveTo(false);
        const save = saveAs(c, 'The Lamplighter');
        await expectAsync(service.run(c.self, 'The Lamplighter', c.route as any, save)).toBeRejectedWith(jasmine.objectContaining({ name: 'RenameCancelledError' }));
        expect(save).not.toHaveBeenCalled();
        expect(electron.rewriteWikiLinks).not.toHaveBeenCalled();
        expect(modal.confirmLinkRename).not.toHaveBeenCalled();
        expect(buildWikiLinkTargets(collections).resolve('The Lamplighter')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'mara' }));
      });
      it("warns when the new name is another record's name", async () => {
        await service.run(c.self, 'mara vell', c.route as any, saveAs(c, 'mara vell'));
        expect(modal.confirm).toHaveBeenCalledTimes(1);
        const message = modal.confirm.calls.mostRecent().args[0];
        expect(message).toContain('"mara vell" is the name of Mara Vell (' + c.singular + ').');
        expect(message).toContain('1 link to Mara Vell will no longer resolve (ambiguous).');
      });
      it('does not warn when the new name is the record\'s own alias', async () => {
        const save = saveAs(c, 'Old Oren');
        await service.run(c.self, 'Old Oren', c.route as any, save);
        expect(modal.confirm).not.toHaveBeenCalled();
        expect(save).toHaveBeenCalledTimes(1);
      });
      it('does not warn for a name nobody uses', async () => {
        await service.run(c.self, 'Someone New', c.route as any, saveAs(c, 'Someone New'));
        expect(modal.confirm).not.toHaveBeenCalled();
      });
    });
  }

  it('names every conflicting record across collections', async () => {
    setup(cases[0]);
    collections.push({ folder: 'houses', route: 'house', singular: 'House', targets: [{ id: 'h', name: 'House Lamp', relativePath: 'h/h.md', aliases: ['the lamplighter'] }] });
    await service.run(cases[0].self, 'The Lamplighter', 'character', saveAs(cases[0], 'The Lamplighter'));
    expect(modal.confirm).toHaveBeenCalledTimes(1);
    const message = modal.confirm.calls.mostRecent().args[0];
    expect(message).toContain('is an alias of Mara Vell (Character)');
    expect(message).toContain('is an alias of House Lamp (House)');
  });
});
