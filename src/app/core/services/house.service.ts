import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { House, HouseFormData } from '../interfaces/house.interface';
import { normalizeHouseData, validateHouseData } from '../utils/house.utils';
import { parseMarkdown, generateMarkdown } from '../utils/markdown.utils';
import { asciiSlugify } from '../utils/slug.utils';
import { generateId } from '../utils/id.utils';
import { pathJoin } from '../utils/path.utils';
import { parseThumbnailReference, resolveThumbnailPath } from '../utils/thumbnail.utils';
import { assertIpcSuccess } from '../utils/ipc.utils';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';

@Injectable({ providedIn: 'root' })
export class HouseService {
  private readonly subject = new BehaviorSubject<House[]>([]);
  readonly houses$ = this.subject.asObservable();
  private projectPath: string | null = null;
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private electron: ElectronService, private projects: ProjectService, watcher: FileWatcherService, private logger: LoggingService) {
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
      if (!projectPath || projectPath !== this.projectPath || projectPath !== this.projects.getCurrentProject()?.path) throw new Error('The project changed.');
      const house = this.getById(id);
      if (!house) throw new Error('This House no longer exists.');
      await this.checkRevision(house.filePath, expectedRaw);
      // Keep crests, notes, and other user files in the folder.
      assertIpcSuccess(await this.electron.deleteFile(house.filePath), 'Delete house');
      if (projectPath === this.projects.getCurrentProject()?.path) this.publish(this.subject.value.filter(item => item.id !== id));
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
}
