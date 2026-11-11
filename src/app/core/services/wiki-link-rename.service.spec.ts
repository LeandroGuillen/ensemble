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
    modal = jasmine.createSpyObj('ModalService', ['confirmLinkRename']);
    modal.confirmLinkRename.and.resolveTo({ update: true, alias: false });
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
  it('surfaces batch failure without claiming the alias was saved', async () => {
    modal.confirmLinkRename.and.resolveTo({ update: true, alias: true });
    electron.rewriteWikiLinks.and.resolveTo({ success: false, error: 'changed on disk' });
    const record = saved();
    await expectAsync(service.run(old, 'Dessir', 'character', async () => record)).toBeRejectedWithError('changed on disk');
    expect((record as { aliases?: string[] }).aliases).toBeUndefined();
  });
});
