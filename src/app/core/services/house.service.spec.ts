import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { HouseService } from './house.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { HouseFormData } from '../interfaces/house.interface';
import { generateMarkdown, parseMarkdown } from '../utils/markdown.utils';

// An in-memory disk exercises the actual Markdown parser, serializer and revision checks.
describe('HouseService', () => {
  let service: HouseService;
  let disk: Map<string, string>;
  let folders: Set<string>;
  let project$: BehaviorSubject<any>;
  let events: Subject<any>;
  let electron: jasmine.SpyObj<ElectronService>;
  const data = (name = 'House Stark'): HouseFormData => ({
    name, motto: 'Winter is coming', colors: ['#ffffff'], characterIds: ['ned'], content: '## Origins\n\nLong ago.',
    leadership: [
      { id: 'founder', characterIds: ['founder'], period: 'Years 1–20', books: [], notes: 'Before the books.' },
      { id: 'joint', characterIds: ['ned', 'cat'], period: 'Years 300–320', books: ['b2'], notes: '' },
      { id: 'restored', characterIds: ['founder'], period: '', books: ['b1'], notes: 'Restored to power.' },
    ], currentLeadershipId: 'joint',
  });

  beforeEach(() => {
    disk = new Map();
    folders = new Set();
    events = new Subject();
    project$ = new BehaviorSubject({ path: '/project', metadata: { books: [{ id: 'b1' }, { id: 'b2' }] } });
    electron = jasmine.createSpyObj('ElectronService', ['fileExists', 'createDirectory', 'readDirectoryRecursive', 'readFile', 'writeFileAtomic', 'deleteFile', 'getImageAsDataUrl']);
    electron.fileExists.and.callFake(async path => disk.has(path) || folders.has(path));
    electron.createDirectory.and.callFake(async path => { folders.add(path); return { success: true }; });
    electron.readDirectoryRecursive.and.callFake(async path => ({ success: true, files: [...disk.keys()].filter(file => file.startsWith(path + '/') && file.endsWith('.md')).map(file => ({ absolutePath: file, relativePath: file.slice(path.length + 1) })) }));
    electron.readFile.and.callFake(async path => disk.has(path) ? { success: true, content: disk.get(path) } : { success: false, error: 'Missing file' });
    electron.writeFileAtomic.and.callFake(async (path, raw) => { disk.set(path, raw); return { success: true }; });
    electron.deleteFile.and.callFake(async path => { disk.delete(path); return { success: true }; });
    electron.getImageAsDataUrl.and.resolveTo(null);
    TestBed.configureTestingModule({ providers: [HouseService,
      { provide: ElectronService, useValue: electron },
      { provide: ProjectService, useValue: { currentProject$: project$, getCurrentProject: () => project$.value } },
      { provide: FileWatcherService, useValue: { fileChanges$: events } },
      { provide: LoggingService, useValue: jasmine.createSpyObj('LoggingService', ['error']) },
    ] });
    service = TestBed.inject(HouseService);
  });

  it('round-trips ordered historical, joint and repeated reigns independently of book order', async () => {
    const created = await service.createHouse(data());
    expect(created.relativePath).toBe('house-stark/house-stark.md');
    await service.loadHouses(true);
    const house = service.getById(created.id)!;
    expect(house.leadership.map(entry => entry.id)).toEqual(['founder', 'joint', 'restored']);
    expect(house.leadership[0].books).toEqual([]);
    expect(house.leadership[1].characterIds).toEqual(['ned', 'cat']);
    expect(house.leadership[2].characterIds).toEqual(['founder']);
    expect(house.currentLeadershipId).toBe('joint');
    expect(house.content).toContain('Long ago.');
  });

  it('persists reordered succession without changing the explicitly selected current reign', async () => {
    const house = await service.createHouse(data());
    await service.updateHouse(house.id, { ...data(), leadership: [...data().leadership].reverse() }, house.raw);
    await service.loadHouses(true);
    expect(service.getById(house.id)!.leadership.map(entry => entry.id)).toEqual(['restored', 'joint', 'founder']);
    expect(service.getById(house.id)!.currentLeadershipId).toBe('joint');
  });

  it('allows membership in multiple houses and serializes simultaneous membership writes', async () => {
    const one = await service.createHouse(data());
    const two = await service.createHouse(data('House Tully'));
    await Promise.all([service.setMembership(one.id, 'sansa', true), service.setMembership(one.id, 'arya', true), service.setMembership(two.id, 'sansa', true)]);
    await service.loadHouses(true);
    expect(service.getById(one.id)!.characterIds).toEqual(['ned', 'sansa', 'arya']);
    expect(service.getById(two.id)!.characterIds).toEqual(['ned', 'sansa']);
    await service.setMembership(one.id, 'sansa', false);
    expect(service.getById(two.id)!.characterIds).toContain('sansa');
  });

  it('preserves existing files when creating houses with colliding names', async () => {
    const one = await service.createHouse(data());
    const raw = disk.get(one.filePath);
    const two = await service.createHouse(data());
    expect(two.filePath).not.toBe(one.filePath);
    expect(disk.get(one.filePath)).toBe(raw);
    expect(service.getSnapshot().length).toBe(2);
  });

  it('keeps stable identity and references when renaming a House', async () => {
    const one = await service.createHouse(data());
    const renamed = await service.updateHouse(one.id, { ...data(), name: 'House Winter' }, one.raw);
    expect(renamed.id).toBe(one.id);
    expect(renamed.filePath).toBe(one.filePath);
    expect(renamed.characterIds).toEqual(one.characterIds);
  });

  it('rejects stale saves and deletes even after the service reloads external changes', async () => {
    const one = await service.createHouse(data());
    const external = one.raw.replace('Winter is coming', 'Externally edited');
    disk.set(one.filePath, external);
    await service.loadHouses(true);
    await expectAsync(service.updateHouse(one.id, { ...data(), motto: 'My edit' }, one.raw)).toBeRejectedWithError(/changed on disk/);
    await expectAsync(service.deleteHouse(one.id, one.raw)).toBeRejectedWithError(/changed on disk/);
    expect(disk.get(one.filePath)).toBe(external);
  });

  it('keeps image and note artifacts when deleting a House', async () => {
    const house = await service.createHouse(data());
    const image = '/project/houses/house-stark/crest.webp';
    const note = '/project/houses/house-stark/notes.md';
    disk.set(image, 'image bytes');
    disk.set(note, 'Personal notes');
    await service.deleteHouse(house.id, house.raw);
    expect(disk.has(house.filePath)).toBeFalse();
    expect(disk.has(image)).toBeTrue();
    expect(disk.has(note)).toBeTrue();
  });

  it('preserves unrecognized frontmatter and historical references when editing', async () => {
    const house = await service.createHouse(data());
    const parsed = parseMarkdown<Record<string, unknown>>(house.raw).data!;
    disk.set(house.filePath, generateMarkdown({ ...parsed.frontmatter, customLore: 'Preserve me' }, parsed.content));
    await service.loadHouses(true);
    const latest = service.getById(house.id)!;
    await service.updateHouse(house.id, { ...latest, motto: 'New motto' }, latest.raw);
    const saved = parseMarkdown<Record<string, unknown>>(disk.get(house.filePath)!).data!;
    expect(saved.frontmatter['customLore']).toBe('Preserve me');
    expect(service.getById(house.id)!.leadership[0].characterIds).toEqual(['founder']);
  });

  it('clears House state when a project closes or switches', async () => {
    await service.createHouse(data());
    project$.next(null);
    expect(service.getSnapshot()).toEqual([]);
    project$.next({ path: '/another', metadata: { books: [] } });
    await service.loadHouses();
    expect(service.getSnapshot()).toEqual([]);
  });

  it('does not publish old project data when the project switches during an update', async () => {
    const house = await service.createHouse(data());
    const original = electron.writeFileAtomic.and.callFake(async (path, raw) => {
      disk.set(path, raw);
      project$.next({ path: '/another', metadata: { books: [] } });
      return { success: true };
    });
    await service.updateHouse(house.id, { ...data(), name: 'Changed' }, house.raw);
    expect(service.getSnapshot()).toEqual([]);
    expect(original).toHaveBeenCalled();
  });

  it('assigns and persists IDs for externally created records', async () => {
    const path = '/project/houses/old/old.md';
    disk.set(path, generateMarkdown({ type: 'house', ...data() }, 'History'));
    await service.loadHouses(true);
    const id = service.getSnapshot()[0].id;
    expect(id).toBeTruthy();
    await service.loadHouses(true);
    expect(service.getSnapshot()[0].id).toBe(id);
  });

  it('blocks invalid leadership and current-head references before writing', async () => {
    await expectAsync(service.createHouse({ ...data(), leadership: [{ ...data().leadership[0], characterIds: [] }] })).toBeRejectedWithError(/at least one head/);
    await expectAsync(service.createHouse({ ...data(), currentLeadershipId: 'missing' })).toBeRejectedWithError(/current head/);
    expect(electron.writeFileAtomic).not.toHaveBeenCalled();
  });

  it('retains the last valid state and reports malformed House files on reload', async () => {
    const house = await service.createHouse(data());
    disk.set(house.filePath, '---\ntype: house\nleadership: [\n---');
    await expectAsync(service.loadHouses(true)).toBeRejected();
    expect(service.getById(house.id)!.raw).toBe(house.raw);
  });
  it('persists missing leadership IDs without losing succession order', async () => {
    const path = '/project/houses/old/old.md';
    const legacy = data();
    const leadership = legacy.leadership.map(({ id, ...entry }) => entry);
    disk.set(path, generateMarkdown({ type: 'house', id: 'old-house', ...legacy, currentLeadershipId: undefined, leadership }, 'History'));
    await service.loadHouses(true);
    const ids = service.getById('old-house')!.leadership.map(entry => entry.id);
    await service.loadHouses(true);
    expect(service.getById('old-house')!.leadership.map(entry => entry.id)).toEqual(ids);
    expect(service.getById('old-house')!.leadership[0].period).toBe('Years 1–20');
  });

  it('refreshes externally added, edited and removed Markdown records', async () => {
    const house = await service.createHouse(data());
    disk.set(house.filePath, house.raw.replace('Winter is coming', 'New motto'));
    events.next({ path: house.filePath, filename: 'house-stark.md', type: 'change' });
    await service.loadHouses(); // Runs after the queued watcher refresh.
    expect(service.getById(house.id)!.motto).toBe('New motto');
    const secondPath = '/project/houses/tully/tully.md';
    disk.set(secondPath, generateMarkdown({ type: 'house', id: 'tully', ...data('House Tully') }, 'History'));
    events.next({ path: secondPath, filename: 'tully.md', type: 'add' });
    await service.loadHouses();
    expect(service.getById('tully')!.name).toBe('House Tully');
    disk.delete(house.filePath);
    events.next({ path: house.filePath, filename: 'house-stark.md', type: 'unlink' });
    await service.loadHouses();
    expect(service.getById(house.id)).toBeUndefined();
  });

});
