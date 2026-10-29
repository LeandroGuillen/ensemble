import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { House, HouseFormData } from '../interfaces/house.interface';
import {
  HouseCharacterRemoval,
  HouseCharacterSnapshot,
  HouseSeatRemoval,
  LocationReferenceSnapshot,
  ReferenceRestoreResult,
} from '../interfaces/reference-snapshot.interface';
import { normalizeHouseData, validateHouseData } from '../utils/house.utils';
import { parseMarkdown, generateMarkdown } from '../utils/markdown.utils';
import { asciiSlugify } from '../utils/slug.utils';
import { generateId } from '../utils/id.utils';
import { pathJoin } from '../utils/path.utils';
import { parseThumbnailReference, resolveThumbnailPath } from '../utils/thumbnail.utils';
import { assertIpcSuccess } from '../utils/ipc.utils';
import {
  sanitizeTrashRecordId,
  trashStagingFailureMessage,
} from '../trash/trash-record-id';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { UndoDeleteService } from './undo-delete.service';

@Injectable({ providedIn: 'root' })
export class HouseService {
  private readonly subject = new BehaviorSubject<House[]>([]);
  readonly houses$ = this.subject.asObservable();
  private projectPath: string | null = null;
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private electron: ElectronService,
    private projects: ProjectService,
    watcher: FileWatcherService,
    private logger: LoggingService,
    private notificationService: NotificationService,
    private undoDelete: UndoDeleteService
  ) {
    this.projects.currentProject$.pipe(takeUntilDestroyed()).subscribe(project => {
      if (project?.path !== this.projectPath) {
        this.projectPath = project?.path || null;
        this.loaded = false;
        this.subject.next([]);
      }
    });
    watcher.fileChanges$.pipe(takeUntilDestroyed()).subscribe(event => {
      if (!event || !this.projectPath) return;
      const root = pathJoin(this.projectPath, 'houses').replace(/\\/g, '/') + '/';
      if (event.path.replace(/\\/g, '/').startsWith(root) && event.filename.endsWith('.md')) {
        void this.loadHouses(true).catch(error => this.logger.error('Failed to reload houses', error));
      }
    });
  }

  getSnapshot(): House[] { return this.subject.value; }
  getById(id: string): House | undefined { return this.subject.value.find(house => house.id === id); }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  loadHouses(force = false): Promise<void> {
    const projectPath = this.projects.getCurrentProject()?.path;
    if (!projectPath) return Promise.resolve();
    return this.serial(() => this.load(projectPath, force));
  }

  private async load(projectPath: string, force = false): Promise<void> {
    if (projectPath !== this.projects.getCurrentProject()?.path) return;
    if (this.loaded && !force && this.projectPath === projectPath) return;
    const root = pathJoin(projectPath, 'houses');
    assertIpcSuccess(await this.electron.createDirectory(root), 'Create houses folder');
    const scan = await this.electron.readDirectoryRecursive(root, '*.md');
    if (!scan.success || !scan.files) throw new Error(scan.error || 'Unable to scan houses');
    const houses: House[] = [];
    const seen = new Set<string>();
    for (const file of scan.files) {
      const read = await this.electron.readFile(file.absolutePath);
      if (!read.success || read.content === undefined) throw new Error(read.error || 'Unable to read house');
      const parsed = parseMarkdown<Record<string, unknown>>(read.content);
      if (!parsed.success) throw new Error(`${file.relativePath}: ${parsed.error}`);
      const fm = parsed.data!.frontmatter;
      if (fm['type'] !== 'house') continue;
      const data = normalizeHouseData(fm, parsed.data!.content);
      let id = typeof fm['id'] === 'string' ? fm['id'].trim() : '';
      const assignId = !id || seen.has(id);
      if (assignId) id = generateId();
      seen.add(id);
      const date = (value: unknown) => {
        const parsedDate = new Date(typeof value === 'string' ? value : '');
        return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
      };
      const house: House = { ...data, id, created: date(fm['created']), modified: date(fm['modified']), filePath: file.absolutePath, relativePath: file.relativePath, raw: read.content };
      const storedLeadership = Array.isArray(fm['leadership']) ? fm['leadership'] : [];
      const leadershipIdsChanged = data.leadership.some((entry, index) => storedLeadership[index]?.id !== entry.id);
      // Persist stable IDs only after ensuring this is still the active project.
      if ((assignId || leadershipIdsChanged) && projectPath === this.projects.getCurrentProject()?.path) await this.write(house, read.content);
      houses.push(house);
    }
    if (projectPath !== this.projects.getCurrentProject()?.path) return;
    this.projectPath = projectPath;
    this.loaded = true;
    this.publish(houses);
  }

  createHouse(data: HouseFormData): Promise<House> {
    const projectPath = this.projects.getCurrentProject()?.path;
    return this.serial(async () => {
      if (!projectPath || projectPath !== this.projects.getCurrentProject()?.path) throw new Error('Select a project first.');
      validateHouseData(data);
      await this.load(projectPath);
      if (projectPath !== this.projects.getCurrentProject()?.path) throw new Error('The project changed.');
      const id = generateId();
      const slug = asciiSlugify(data.name) || 'house';
      const root = pathJoin(projectPath, 'houses');
      let folder = slug;
      if (await this.electron.fileExists(pathJoin(root, folder))) folder = `${slug}-${id}`;
      assertIpcSuccess(await this.electron.createDirectory(pathJoin(root, folder)), 'Create house folder');
      const now = new Date();
      const house: House = { ...structuredClone(data), name: data.name.trim(), id, created: now, modified: now, relativePath: `${folder}/${folder}.md`, filePath: pathJoin(root, folder, `${folder}.md`), raw: '' };
      await this.write(house);
      if (projectPath === this.projects.getCurrentProject()?.path) this.publish([...this.subject.value, house]);
      return house;
    });
  }

  updateHouse(id: string, data: HouseFormData, expectedRaw: string): Promise<House> {
    const projectPath = this.projects.getCurrentProject()?.path;
    return this.serial(async () => {
      if (!projectPath || projectPath !== this.projectPath || projectPath !== this.projects.getCurrentProject()?.path) throw new Error('The project changed. Reopen the House.');
      return this.update(id, data, expectedRaw);
    });
  }

  private async update(id: string, data: HouseFormData, expectedRaw: string): Promise<House> {
    validateHouseData(data);
    const existing = this.getById(id);
    if (!existing) throw new Error('This House no longer exists.');
    const projectPath = this.projectPath;
    const house: House = { ...existing, ...structuredClone(data), id: existing.id, filePath: existing.filePath, relativePath: existing.relativePath, created: existing.created, name: data.name.trim(), modified: new Date() };
    await this.write(house, expectedRaw);
    if (projectPath === this.projects.getCurrentProject()?.path) {
      this.publish(this.subject.value.map(item => item.id === id ? house : item));
    }
    return house;
  }

  setMembership(houseId: string, characterId: string, member: boolean): Promise<void> {
    const projectPath = this.projects.getCurrentProject()?.path;
    return this.serial(async () => {
      if (!projectPath || projectPath !== this.projectPath || projectPath !== this.projects.getCurrentProject()?.path) throw new Error('The project changed.');
      const house = this.getById(houseId);
      if (!house) throw new Error('This House no longer exists.');
      const characterIds = member ? [...new Set([...house.characterIds, characterId])] : house.characterIds.filter(id => id !== characterId);
      await this.update(houseId, { ...house, characterIds }, house.raw);
    });
  }

  deleteHouse(id: string, expectedRaw: string): Promise<void> {
    const projectPath = this.projects.getCurrentProject()?.path;
    return this.serial(async () => {
      if (!projectPath || projectPath !== this.projectPath || projectPath !== this.projects.getCurrentProject()?.path) {
        throw new Error('The project changed.');
      }
      const house = this.getById(id);
      if (!house) {
        throw new Error('This House no longer exists.');
      }
      await this.checkRevision(house.filePath, expectedRaw);

      // Stage the house .md only — keep crests, notes, and other user files in the folder.
      const name = house.name || 'Untitled';
      const stageResult = await this.electron.stageForTrash(projectPath, house.filePath, {
        kind: 'house',
        recordId: sanitizeTrashRecordId(house.id),
        name,
      });
      if (!stageResult.success || !stageResult.token) {
        const err = stageResult.error || 'Unknown error';
        this.notificationService.showError(trashStagingFailureMessage(name, err));
        throw new Error(err);
      }

      if (projectPath === this.projects.getCurrentProject()?.path) {
        this.publish(this.subject.value.filter((item) => item.id !== id));
      }

      const recordId = house.id;
      this.undoDelete.register(stageResult.token, {
        kind: 'house',
        recordId,
        name,
        referenceSnapshot: null,
        expiresAt: stageResult.expiresAt,
        hasConflict: () => {
          if (this.getById(recordId)) {
            return true;
          }
          const needle = name.trim().toLowerCase();
          if (!needle) {
            return false;
          }
          return this.subject.value.some(
            (h) => (h.name || '').trim().toLowerCase() === needle
          );
        },
        reload: async () => {
          await this.loadHouses(true);
        },
        restoreReferences: async () => ({ restored: 0, skipped: [] }),
      });
    });
  }

  private async checkRevision(path: string, expectedRaw: string): Promise<void> {
    const read = await this.electron.readFile(path);
    if (!read.success || read.content !== expectedRaw) throw new Error('This House changed on disk. Reload before saving or deleting.');
  }

  private async write(house: House, expectedRaw?: string): Promise<void> {
    if (expectedRaw !== undefined) await this.checkRevision(house.filePath, expectedRaw);
    else if (await this.electron.fileExists(house.filePath)) throw new Error('A House file already exists at this path.');
    const previous = parseMarkdown<Record<string, unknown>>(house.raw).data?.frontmatter || {};
    const { name, motto, colors, thumbnail, seatId, characterIds, leadership, currentLeadershipId } = house;
    const fm = { ...previous, type: 'house', id: house.id, name, motto, colors, thumbnail: thumbnail || undefined, seatId: seatId || undefined, characterIds, leadership, currentLeadershipId: currentLeadershipId || undefined, created: house.created.toISOString(), modified: house.modified.toISOString() };
    const raw = generateMarkdown(fm, house.content);
    assertIpcSuccess(await this.electron.writeFileAtomic(house.filePath, raw), 'Save house');
    house.raw = raw;
  }

  async loadCrest(house: Pick<House, 'thumbnail'>): Promise<string | null> {
    const project = this.projects.getCurrentProject();
    const parsed = parseThumbnailReference(house.thumbnail || '');
    return project && parsed ? this.electron.getImageAsDataUrl(resolveThumbnailPath(project.path, parsed)) : null;
  }

  private publish(houses: House[]): void { this.subject.next([...houses].sort((a, b) => a.name.localeCompare(b.name))); }

  /**
   * Count how many houses reference a character (for deletion confirmation)
   */
  countCharacterReferences(characterId: string): { id: string; name: string }[] {
    const houses = this.subject.value;
    const referencedHouses: { id: string; name: string }[] = [];
    
    for (const house of houses) {
      // Check if character is a member or in any leadership entry
      const isMember = house.characterIds.includes(characterId);
      const inLeadership = house.leadership.some(reign => reign.characterIds.includes(characterId));
      
      if (isMember || inLeadership) {
        referencedHouses.push({ id: house.id, name: house.name });
      }
    }
    
    return referencedHouses;
  }

  /**
   * Remove a character from all house memberships and leadership (for deletion cleanup).
   * Returns a typed snapshot of prior membership/leadership for Undo restore.
   */
  async removeCharacterFromHouses(characterId: string): Promise<HouseCharacterSnapshot> {
    const empty: HouseCharacterSnapshot = { characterId, removals: [] };
    const projectPath = this.projects.getCurrentProject()?.path;
    if (!projectPath) return empty;

    return this.serial(async () => {
      if (projectPath !== this.projects.getCurrentProject()?.path) return empty;
      await this.load(projectPath, true);

      const houses = this.subject.value;
      const removals: HouseCharacterRemoval[] = [];
      const affectedHouses: House[] = [];

      for (const house of houses) {
        let changed = false;
        const previousLeadership = structuredClone(house.leadership);
        const previousCharacterIds = [...house.characterIds];
        const previousCurrentLeadershipId = house.currentLeadershipId;
        const updatedHouse = { ...house };

        if (updatedHouse.characterIds.includes(characterId)) {
          updatedHouse.characterIds = updatedHouse.characterIds.filter(id => id !== characterId);
          changed = true;
        }

        const updatedLeadership = updatedHouse.leadership.map(reign => {
          if (reign.characterIds.includes(characterId)) {
            changed = true;
            return {
              ...reign,
              characterIds: reign.characterIds.filter(id => id !== characterId)
            };
          }
          return reign;
        });

        const prunedReigns = updatedLeadership.filter(reign => reign.characterIds.length === 0);
        updatedHouse.leadership = updatedLeadership.filter(reign => reign.characterIds.length > 0);

        if (updatedHouse.currentLeadershipId && !updatedHouse.leadership.some(r => r.id === updatedHouse.currentLeadershipId)) {
          updatedHouse.currentLeadershipId = undefined;
          changed = true;
        }

        if (changed) {
          removals.push({
            houseId: house.id,
            houseName: house.name,
            characterIds: previousCharacterIds,
            leadership: previousLeadership,
            currentLeadershipId: previousCurrentLeadershipId,
            prunedReigns: structuredClone(prunedReigns.map((reign) => {
              const original = previousLeadership.find((r) => r.id === reign.id);
              return original ? structuredClone(original) : structuredClone(reign);
            })),
          });
          affectedHouses.push(updatedHouse);
        }
      }

      for (const house of affectedHouses) {
        await this.update(house.id, house, house.raw);
      }

      return { characterId, removals };
    });
  }

  /**
   * Restore house membership/leadership from a removeCharacterFromHouses snapshot.
   * Re-adds only the deleted character (never overwrites whole lists): inserts at its
   * prior index in characterIds and each surviving reign, re-creates pruned reigns
   * with only that id, and restores currentLeadershipId only when still unset and
   * the reign exists again. Skips houses that no longer exist.
   */
  async restoreCharacterToHouses(snapshot: HouseCharacterSnapshot): Promise<ReferenceRestoreResult> {
    const result: ReferenceRestoreResult = { restored: 0, skipped: [] };
    const projectPath = this.projects.getCurrentProject()?.path;
    const characterId = snapshot?.characterId;
    if (!projectPath || !characterId || !snapshot?.removals?.length) return result;

    return this.serial(async () => {
      if (projectPath !== this.projects.getCurrentProject()?.path) return result;
      await this.load(projectPath, true);

      for (const removal of snapshot.removals) {
        const house = this.getById(removal.houseId);
        if (!house) {
          result.skipped.push({
            kind: 'house',
            id: removal.houseId,
            label: removal.houseName || removal.houseId,
          });
          continue;
        }

        const nextCharacterIds = [...house.characterIds];
        if (!nextCharacterIds.includes(characterId)) {
          const memberIndex = removal.characterIds.indexOf(characterId);
          const insertAt =
            memberIndex < 0
              ? nextCharacterIds.length
              : Math.min(memberIndex, nextCharacterIds.length);
          nextCharacterIds.splice(insertAt, 0, characterId);
        }

        const nextLeadership = house.leadership.map((reign) => ({
          ...reign,
          characterIds: [...reign.characterIds],
        }));

        for (const priorReign of removal.leadership) {
          if (!priorReign.characterIds.includes(characterId)) {
            continue;
          }
          const liveIndex = nextLeadership.findIndex((reign) => reign.id === priorReign.id);
          if (liveIndex !== -1) {
            const live = nextLeadership[liveIndex];
            if (!live.characterIds.includes(characterId)) {
              const reignMemberIndex = priorReign.characterIds.indexOf(characterId);
              const insertAt =
                reignMemberIndex < 0
                  ? live.characterIds.length
                  : Math.min(reignMemberIndex, live.characterIds.length);
              live.characterIds.splice(insertAt, 0, characterId);
            }
            continue;
          }

          // Reign is gone: either we pruned it, or a later delete emptied it.
          // Re-create with only the character being undone (never revive peers).
          const template =
            removal.prunedReigns.find((reign) => reign.id === priorReign.id) || priorReign;
          const restoredReign = {
            ...structuredClone(template),
            characterIds: [characterId],
          };
          const priorLeadershipIndex = removal.leadership.findIndex(
            (reign) => reign.id === priorReign.id
          );
          const insertAt =
            priorLeadershipIndex < 0
              ? nextLeadership.length
              : Math.min(priorLeadershipIndex, nextLeadership.length);
          nextLeadership.splice(insertAt, 0, restoredReign);
        }

        let nextCurrentLeadershipId = house.currentLeadershipId;
        if (
          !nextCurrentLeadershipId &&
          removal.currentLeadershipId &&
          nextLeadership.some((reign) => reign.id === removal.currentLeadershipId)
        ) {
          nextCurrentLeadershipId = removal.currentLeadershipId;
        }

        await this.update(
          house.id,
          {
            ...house,
            characterIds: nextCharacterIds,
            leadership: nextLeadership,
            currentLeadershipId: nextCurrentLeadershipId,
          },
          house.raw
        );
        result.restored += 1;
      }
      return result;
    });
  }

  /**
   * Clear seatId from any houses that reference a deleted location.
   * Returns prior seatId values for Undo restore.
   */
  async clearLocationReferences(locationId: string): Promise<LocationReferenceSnapshot> {
    const empty: LocationReferenceSnapshot = { locationId, seats: [] };
    const projectPath = this.projects.getCurrentProject()?.path;
    if (!projectPath) return empty;

    return this.serial(async () => {
      if (projectPath !== this.projects.getCurrentProject()?.path) return empty;
      await this.load(projectPath, true);

      const houses = this.subject.value;
      const seats: HouseSeatRemoval[] = [];
      const affectedHouses = houses.filter(house => house.seatId === locationId);

      for (const house of affectedHouses) {
        seats.push({
          houseId: house.id,
          houseName: house.name,
          seatId: locationId,
        });
        const updatedHouse = { ...house, seatId: undefined };
        await this.update(house.id, updatedHouse, house.raw);
      }

      return { locationId, seats };
    });
  }

  /**
   * Restore House seatId values cleared by clearLocationReferences.
   * Skips houses that no longer exist.
   */
  async restoreLocationReferences(snapshot: LocationReferenceSnapshot): Promise<ReferenceRestoreResult> {
    const result: ReferenceRestoreResult = { restored: 0, skipped: [] };
    const projectPath = this.projects.getCurrentProject()?.path;
    if (!projectPath || !snapshot?.seats?.length) return result;

    return this.serial(async () => {
      if (projectPath !== this.projects.getCurrentProject()?.path) return result;
      await this.load(projectPath, true);

      for (const seat of snapshot.seats) {
        const house = this.getById(seat.houseId);
        if (!house) {
          result.skipped.push({
            kind: 'house',
            id: seat.houseId,
            label: seat.houseName || seat.houseId,
          });
          continue;
        }
        // Do not overwrite a seat assigned during the Undo window.
        if (house.seatId) {
          result.restored += 1;
          continue;
        }
        await this.update(house.id, { ...house, seatId: seat.seatId }, house.raw);
        result.restored += 1;
      }
      return result;
    });
  }
}
