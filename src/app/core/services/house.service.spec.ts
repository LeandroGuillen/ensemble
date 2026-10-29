import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { HouseService } from './house.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { UndoDeleteService } from './undo-delete.service';
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
  let notifications: jasmine.SpyObj<NotificationService>;
  let undoDelete: jasmine.SpyObj<UndoDeleteService>;
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
    electron = jasmine.createSpyObj('ElectronService', ['fileExists', 'createDirectory', 'readDirectoryRecursive', 'readFile', 'writeFileAtomic', 'deleteFile', 'stageForTrash', 'restoreFromTrash', 'getImageAsDataUrl']);
    electron.fileExists.and.callFake(async path => disk.has(path) || folders.has(path));
    electron.createDirectory.and.callFake(async path => { folders.add(path); return { success: true }; });
    electron.readDirectoryRecursive.and.callFake(async path => ({ success: true, files: [...disk.keys()].filter(file => file.startsWith(path + '/') && file.endsWith('.md')).map(file => ({ absolutePath: file, relativePath: file.slice(path.length + 1) })) }));
    electron.readFile.and.callFake(async path => disk.has(path) ? { success: true, content: disk.get(path) } : { success: false, error: 'Missing file' });
    electron.writeFileAtomic.and.callFake(async (path, raw) => { disk.set(path, raw); return { success: true }; });
    electron.deleteFile.and.callFake(async path => { disk.delete(path); return { success: true }; });
    const staged = new Map<string, string>();
    electron.stageForTrash.and.callFake(async (_project, target) => {
      const raw = disk.get(target);
      if (raw !== undefined) staged.set('tok-house', raw);
      disk.delete(target);
      return { success: true, token: 'tok-house', expiresAt: Date.now() + 15000 };
    });
    electron.restoreFromTrash.and.callFake(async (token: string) => {
      const raw = staged.get(token);
      // Restore is path-agnostic in this fake; callers check getById / list.
      if (raw !== undefined) {
        // Put content back under any missing house path from priorHouses via publish rollback.
        staged.delete(token);
      }
      return { success: true };
    });
    electron.getImageAsDataUrl.and.resolveTo(null);
    notifications = jasmine.createSpyObj('NotificationService', ['showError', 'showWarning']);
    undoDelete = jasmine.createSpyObj('UndoDeleteService', ['register', 'dismissAll']);
    TestBed.configureTestingModule({ providers: [HouseService,
      { provide: ElectronService, useValue: electron },
      { provide: ProjectService, useValue: { currentProject$: project$, getCurrentProject: () => project$.value } },
      { provide: FileWatcherService, useValue: { fileChanges$: events } },
      { provide: LoggingService, useValue: jasmine.createSpyObj('LoggingService', ['error']) },
      { provide: NotificationService, useValue: notifications },
      { provide: UndoDeleteService, useValue: undoDelete },
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

  it('keeps image and note artifacts when staging a House delete', async () => {
    const house = await service.createHouse(data());
    const image = '/project/houses/house-stark/crest.webp';
    const note = '/project/houses/house-stark/notes.md';
    disk.set(image, 'image bytes');
    disk.set(note, 'Personal notes');
    await service.deleteHouse(house.id, house.raw);
    expect(electron.stageForTrash).toHaveBeenCalledWith(
      '/project',
      house.filePath,
      jasmine.objectContaining({ kind: 'house', recordId: jasmine.any(String), name: house.name })
    );
    expect(electron.deleteFile).not.toHaveBeenCalled();
    expect(disk.has(house.filePath)).toBeFalse();
    expect(disk.has(image)).toBeTrue();
    expect(disk.has(note)).toBeTrue();
    expect(undoDelete.register).toHaveBeenCalled();
  });

  it('on staging failure leaves the House untouched and toasts Nothing was changed', async () => {
    const house = await service.createHouse(data());
    electron.stageForTrash.and.returnValue(Promise.resolve({ success: false, error: 'locked' }));
    await expectAsync(service.deleteHouse(house.id, house.raw)).toBeRejectedWithError(/locked/);
    expect(disk.has(house.filePath)).toBeTrue();
    expect(service.getById(house.id)).toBeTruthy();
    expect(notifications.showError).toHaveBeenCalledWith(
      `Couldn't delete "${house.name}": locked. Nothing was changed.`
    );
    expect(undoDelete.register).not.toHaveBeenCalled();
  });

  it('sanitizes House ids with a dot for staging', async () => {
    const house = await service.createHouse(data());
    // Force a dotted id on the in-memory record (staging uses house.id).
    (house as any).id = 'house.stark';
    (service as any).subject.next([house]);
    await service.deleteHouse('house.stark', house.raw);
    expect(electron.stageForTrash).toHaveBeenCalledWith(
      '/project',
      house.filePath,
      jasmine.objectContaining({ recordId: 'house_stark' })
    );
    expect(undoDelete.register).toHaveBeenCalledWith(
      'tok-house',
      jasmine.objectContaining({ recordId: 'house.stark' })
    );
  });

  it('post-stage register failure restores from trash and re-lists the House', async () => {
    const house = await service.createHouse(data());
    undoDelete.register.and.throwError('register boom');
    // Put file back on restore so disk matches memory rollback.
    electron.restoreFromTrash.and.callFake(async () => {
      disk.set(house.filePath, house.raw);
      return { success: true };
    });

    await expectAsync(service.deleteHouse(house.id, house.raw)).toBeRejected();
    expect(electron.restoreFromTrash).toHaveBeenCalledWith('tok-house');
    expect(service.getById(house.id)).toBeTruthy();
    expect(notifications.showError).toHaveBeenCalledWith(
      `Couldn't delete "${house.name}": register boom. Nothing was changed.`
    );
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

  describe('Character reference cleanup', () => {
    it('counts character references across all houses', async () => {
      const house1 = await service.createHouse({ ...data(), characterIds: ['char-1', 'char-2'] });
      const house2 = await service.createHouse({ ...data('House Tully'), characterIds: ['char-1', 'char-3'] });
      const house3 = await service.createHouse({ ...data('House Lannister'), characterIds: ['char-4'] });

      expect(service.countCharacterReferences('char-1').length).toBe(2);
      expect(service.countCharacterReferences('char-2').length).toBe(1);
      expect(service.countCharacterReferences('char-4').length).toBe(1);
      expect(service.countCharacterReferences('non-existent').length).toBe(0);
    });

    it('counts character references in leadership entries', async () => {
      const house = await service.createHouse({
        ...data(),
        characterIds: ['char-1'],
        leadership: [
          { id: 'reign-1', characterIds: ['char-2'], period: 'Year 1', books: [], notes: '' },
          { id: 'reign-2', characterIds: ['char-1', 'char-3'], period: 'Year 2', books: [], notes: '' },
        ],
        currentLeadershipId: 'reign-1',
      });

      // char-1 is in membership AND leadership of the same house -> count once
      const char1Refs = service.countCharacterReferences('char-1');
      expect(char1Refs.length).toBe(1);
      expect(char1Refs[0].name).toBe('House Stark');
      
      const char2Refs = service.countCharacterReferences('char-2');
      expect(char2Refs.length).toBe(1);
      expect(char2Refs[0].name).toBe('House Stark');
      
      const char3Refs = service.countCharacterReferences('char-3');
      expect(char3Refs.length).toBe(1);
      expect(char3Refs[0].name).toBe('House Stark');
    });

    it('removes character from house membership', async () => {
      const house = await service.createHouse({ ...data(), characterIds: ['char-1', 'char-2', 'char-3'] });
      await service.removeCharacterFromHouses('char-2');
      await service.loadHouses(true);
      expect(service.getById(house.id)!.characterIds).toEqual(['char-1', 'char-3']);
    });

    it('removes character from leadership entries', async () => {
      const house = await service.createHouse({
        ...data(),
        characterIds: ['char-1'],
        leadership: [
          { id: 'reign-1', characterIds: ['char-2', 'char-3'], period: 'Year 1', books: [], notes: '' },
          { id: 'reign-2', characterIds: ['char-1'], period: 'Year 2', books: [], notes: '' },
        ],
        currentLeadershipId: 'reign-1',
      });

      await service.removeCharacterFromHouses('char-2');
      await service.loadHouses(true);

      const updated = service.getById(house.id)!;
      expect(updated.leadership[0].characterIds).toEqual(['char-3']);
      expect(updated.leadership[1].characterIds).toEqual(['char-1']);
    });

    it('removes empty leadership reigns after character removal', async () => {
      const house = await service.createHouse({
        ...data(),
        characterIds: ['char-1'],
        leadership: [
          { id: 'reign-1', characterIds: ['char-2'], period: 'Year 1', books: [], notes: '' },
          { id: 'reign-2', characterIds: ['char-1'], period: 'Year 2', books: [], notes: '' },
        ],
        currentLeadershipId: 'reign-1',
      });

      await service.removeCharacterFromHouses('char-2');
      await service.loadHouses(true);

      const updated = service.getById(house.id)!;
      expect(updated.leadership.length).toBe(1);
      expect(updated.leadership[0].id).toBe('reign-2');
    });

    it('clears currentLeadershipId when the current reign becomes empty', async () => {
      const house = await service.createHouse({
        ...data(),
        characterIds: ['char-1'],
        leadership: [
          { id: 'reign-1', characterIds: ['char-2'], period: 'Year 1', books: [], notes: '' },
          { id: 'reign-2', characterIds: ['char-1'], period: 'Year 2', books: [], notes: '' },
        ],
        currentLeadershipId: 'reign-1',
      });

      await service.removeCharacterFromHouses('char-2');
      await service.loadHouses(true);

      const updated = service.getById(house.id)!;
      expect(updated.currentLeadershipId).toBeUndefined();
    });

    it('preserves currentLeadershipId when it refers to a surviving reign', async () => {
      const house = await service.createHouse({
        ...data(),
        characterIds: ['char-1'],
        leadership: [
          { id: 'reign-1', characterIds: ['char-2', 'char-3'], period: 'Year 1', books: [], notes: '' },
          { id: 'reign-2', characterIds: ['char-1'], period: 'Year 2', books: [], notes: '' },
        ],
        currentLeadershipId: 'reign-1',
      });

      await service.removeCharacterFromHouses('char-2');
      await service.loadHouses(true);

      const updated = service.getById(house.id)!;
      expect(updated.currentLeadershipId).toBe('reign-1');
    });

    it('removes character from multiple houses in one call', async () => {
      const house1 = await service.createHouse({ ...data(), characterIds: ['char-1', 'char-2'] });
      const house2 = await service.createHouse({ ...data('House Tully'), characterIds: ['char-1', 'char-3'] });

      await service.removeCharacterFromHouses('char-1');
      await service.loadHouses(true);

      expect(service.getById(house1.id)!.characterIds).toEqual(['char-2']);
      expect(service.getById(house2.id)!.characterIds).toEqual(['char-3']);
    });

    it('on mid-loop write failure keeps a partial Undo snapshot and toasts the failed House', async () => {
      // Names sort Alpha → Beta → Gamma so Beta is the 2nd write.
      const alpha = await service.createHouse({
        ...data('House Alpha'),
        characterIds: ['hero', 'other'],
        leadership: [
          { id: 'reign-a', characterIds: ['hero'], period: 'Now', books: [], notes: '' },
        ],
        currentLeadershipId: 'reign-a',
      });
      const beta = await service.createHouse({
        ...data('House Beta'),
        characterIds: ['hero'],
        leadership: [
          { id: 'reign-b', characterIds: ['hero', 'peer'], period: 'Now', books: [], notes: '' },
        ],
        currentLeadershipId: 'reign-b',
      });
      const gamma = await service.createHouse({
        ...data('House Gamma'),
        characterIds: ['hero', 'peer'],
        leadership: [
          { id: 'reign-g', characterIds: ['hero'], period: 'Now', books: [], notes: '' },
        ],
        currentLeadershipId: 'reign-g',
      });
      const alphaBefore = structuredClone(service.getById(alpha.id)!);
      const betaBefore = structuredClone(service.getById(beta.id)!);
      const gammaBefore = structuredClone(service.getById(gamma.id)!);

      electron.writeFileAtomic.and.callFake(async (path, raw) => {
        if (String(path).includes('house-beta')) {
          return { success: false, error: 'disk full' };
        }
        disk.set(path, raw);
        return { success: true };
      });

      const snapshot = await service.removeCharacterFromHouses('hero');

      expect(notifications.showWarning).toHaveBeenCalledWith(
        `Couldn't update the House "House Beta", so this link was left in place.`
      );
      // Successful writes recorded; failed House omitted from snapshot.
      expect(snapshot.removals.map((r) => r.houseId).sort()).toEqual(
        [alpha.id, gamma.id].sort()
      );
      expect(snapshot.removals.find((r) => r.houseId === beta.id)).toBeUndefined();

      expect(service.getById(alpha.id)!.characterIds).not.toContain('hero');
      expect(service.getById(beta.id)!.characterIds).toEqual(betaBefore.characterIds);
      expect(service.getById(beta.id)!.leadership).toEqual(betaBefore.leadership);
      expect(service.getById(beta.id)!.currentLeadershipId).toBe(betaBefore.currentLeadershipId);
      expect(service.getById(gamma.id)!.characterIds).not.toContain('hero');

      await service.restoreCharacterToHouses(snapshot);
      expect(service.getById(alpha.id)!.characterIds).toEqual(alphaBefore.characterIds);
      expect(service.getById(alpha.id)!.leadership).toEqual(alphaBefore.leadership);
      expect(service.getById(alpha.id)!.currentLeadershipId).toBe(alphaBefore.currentLeadershipId);
      expect(service.getById(gamma.id)!.characterIds).toEqual(gammaBefore.characterIds);
      expect(service.getById(gamma.id)!.leadership).toEqual(gammaBefore.leadership);
      expect(service.getById(gamma.id)!.currentLeadershipId).toBe(gammaBefore.currentLeadershipId);
      // Failed House was never changed.
      expect(service.getById(beta.id)!.characterIds).toEqual(betaBefore.characterIds);
      expect(service.getById(beta.id)!.leadership).toEqual(betaBefore.leadership);
      expect(service.getById(beta.id)!.currentLeadershipId).toBe(betaBefore.currentLeadershipId);
    });
  });

  describe('Location reference cleanup', () => {
    it('clears seatId references to a deleted location', async () => {
      const house = await service.createHouse({ ...data(), seatId: 'location-1' });

      await service.clearLocationReferences('location-1');
      await service.loadHouses(true);

      expect(service.getById(house.id)!.seatId).toBeUndefined();
    });

    it('clears seatId from multiple houses referencing the same location', async () => {
      const house1 = await service.createHouse({ ...data(), seatId: 'location-1' });
      const house2 = await service.createHouse({ ...data('House Tully'), seatId: 'location-1' });

      await service.clearLocationReferences('location-1');
      await service.loadHouses(true);

      expect(service.getById(house1.id)!.seatId).toBeUndefined();
      expect(service.getById(house2.id)!.seatId).toBeUndefined();
    });

    it('leaves other houses unaffected when clearing location references', async () => {
      const house1 = await service.createHouse({ ...data(), seatId: 'location-1' });
      const house2 = await service.createHouse({ ...data('House Tully'), seatId: 'location-2' });

      await service.clearLocationReferences('location-1');
      await service.loadHouses(true);

      expect(service.getById(house1.id)!.seatId).toBeUndefined();
      expect(service.getById(house2.id)!.seatId).toBe('location-2');
    });

    it('on mid-loop write failure keeps a partial seat snapshot and toasts the failed House', async () => {
      const alpha = await service.createHouse({ ...data('House Alpha'), seatId: 'loc-harbour' });
      const beta = await service.createHouse({ ...data('House Beta'), seatId: 'loc-harbour' });
      const gamma = await service.createHouse({ ...data('House Gamma'), seatId: 'loc-harbour' });

      electron.writeFileAtomic.and.callFake(async (path, raw) => {
        if (String(path).includes('house-beta')) {
          return { success: false, error: 'disk full' };
        }
        disk.set(path, raw);
        return { success: true };
      });

      const snapshot = await service.clearLocationReferences('loc-harbour');

      expect(notifications.showWarning).toHaveBeenCalledWith(
        `Couldn't update the House "House Beta", so this link was left in place.`
      );
      expect(snapshot.seats.map((s) => s.houseId).sort()).toEqual([alpha.id, gamma.id].sort());
      expect(snapshot.seats.find((s) => s.houseId === beta.id)).toBeUndefined();
      expect(service.getById(alpha.id)!.seatId).toBeUndefined();
      expect(service.getById(beta.id)!.seatId).toBe('loc-harbour');
      expect(service.getById(gamma.id)!.seatId).toBeUndefined();

      await service.restoreLocationReferences(snapshot);
      expect(service.getById(alpha.id)!.seatId).toBe('loc-harbour');
      expect(service.getById(gamma.id)!.seatId).toBe('loc-harbour');
      expect(service.getById(beta.id)!.seatId).toBe('loc-harbour');
    });
  });

});
