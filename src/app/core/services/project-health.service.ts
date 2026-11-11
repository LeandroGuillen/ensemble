import { Injectable, inject } from '@angular/core';
import { CharacterService } from './character.service';
import { LocationService } from './location.service';
import { HouseService } from './house.service';
import { CastService } from './cast.service';
import { ProjectService } from './project.service';
import { MetadataService } from './metadata.service';
import { PlotBoardService } from './plot-board.service';
import { ElectronService } from './electron.service';
import { ModalService } from './modal.service';
import { NotificationService } from './notification.service';
import { UNDO_WINDOW_MS } from '../trash/trash-constants';
import { HealthDocument, HealthFinding, HealthSnapshot, checkProjectHealth } from '../utils/project-health.utils';
import { pathDirname, pathJoin } from '../utils/path.utils';
import { parseThumbnailReference, resolveThumbnailForStyle, resolveThumbnailPath } from '../utils/thumbnail.utils';
import { parseBookPlan } from '../utils/book-plan.utils';

@Injectable({ providedIn: 'root' })
export class ProjectHealthService {
  private readonly characters = inject(CharacterService);
  private readonly locations = inject(LocationService);
  private readonly houses = inject(HouseService);
  private readonly casts = inject(CastService);
  private readonly projects = inject(ProjectService);
  private readonly metadata = inject(MetadataService);
  private readonly boards = inject(PlotBoardService);
  private readonly electron = inject(ElectronService);
  private readonly modal = inject(ModalService);
  private readonly notifications = inject(NotificationService);

  /** Scan loaded records and ancillary files without invoking any save or cleanup operation. */
  async scan(styleId?: string): Promise<HealthFinding[]> {
    const project = this.projects.getCurrentProject();
    if (!project) return [];
    const [houses, casts, records, locations] = await Promise.all([this.houses.readHealthSnapshot(), this.casts.readHealthSnapshot(),
      this.characters.readHealthSnapshot(), this.locations.readHealthSnapshot()]);
    this.assertProject(project.path);
    const style = styleId || project.metadata.lastSession?.lastCharacterListStyle || project.metadata.settings.defaultCharacterStyle || 'default';
    const data: HealthSnapshot = { metadata: { ...project.metadata, settings: { ...project.metadata.settings, defaultCharacterStyle: style } },
      characters: records.filter(record => !record.draft), drafts: records.filter(record => record.draft),
      locations, houses,
      casts, boards: [], documents: [] };
    const additional: HealthFinding[] = [];
    const jobs: (() => Promise<void>)[] = [];
    const read = async (path: string) => {
      const result = await this.electron.readFile(path);
      if (!result.success) throw new Error(`Could not read ${path}. ${result.error || ''}`);
      return result.content || '';
    };
    const document = (name: string, content: string, route: string[], queryParams?: Record<string, string>): HealthDocument =>
      ({ name, content, route, queryParams });
    for (const record of [...data.characters, ...data.drafts]) {
      for (const book of record.books) jobs.push(async () => {
        const path = this.characters.getBookPageFilePath(record, book);
        if (await this.electron.fileExists(path)) data.documents.push(document(record.name, await read(path),
          [record.draft ? '/character-draft' : '/character', record.id], { book }));
      });
      const style = data.metadata.settings.defaultCharacterStyle || 'default';
      const reference = parseThumbnailReference(resolveThumbnailForStyle(record.thumbnails, style) || '');
      if (reference) jobs.push(async () => {
        const path = resolveThumbnailPath(project.path, reference, pathDirname(record.filePath));
        if (!(await this.electron.fileExists(path))) additional.push({ ...document(record.name, '',
          [record.draft ? '/character-draft' : '/character', record.id]), group: 'Missing portraits', message: `Portrait file not found for ${style}: ${reference}` });
      });
    }
    for (const cast of data.casts) data.documents.push(document(cast.name, cast.description || '', ['/cast', cast.id]));
    for (const house of data.houses) data.documents.push(document(house.name,
      [house.motto, ...house.leadership.map(reign => reign.notes)].join('\n'), ['/house', house.id]));
    const characters = new Set(data.characters.map(record => record.id));
    for (const book of data.metadata.books) {
      data.documents.push(document(book.name, book.description || '', ['/book', book.id]));
      if (book.plan?.path) jobs.push(async () => {
        const content = await read(pathJoin(project.path, book.plan!.path));
        data.documents.push(document(book.name, content, ['/book', book.id]));
        for (const chapter of parseBookPlan(content).chapters) for (const pov of chapter.pov) {
          if (!characters.has(pov.characterId)) additional.push({ ...document(book.name, '', ['/book', book.id]),
            group: 'Orphaned IDs', message: `${chapter.title} PoV: missing ID ${pov.characterId}`,
            fix: { kind: 'plan', owner: book.id, field: book.plan!.path, missing: pov.characterId } });
        }
      });
    }
    for (const path of await this.boards.discoverPlotboardFiles()) {
      if (path.split(/[\\/]/).some(part => part.startsWith('.'))) continue;
      jobs.push(async () => {
        const board = this.boards.parseFile(await read(pathJoin(project.path, path)));
        data.boards.push({ path, board });
        data.documents.push(document(path, Object.values(board.cells).flatMap(cells => Object.values(cells)).join('\n'),
          ['/plot-board', ...path.split('/')]));
      });
    }
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(12, jobs.length) }, async () => {
      while (next < jobs.length) { this.assertProject(project.path); await jobs[next++](); }
    }));
    this.assertProject(project.path);
    return [...checkProjectHealth(data), ...additional];
  }

  private assertProject(path: string): void {
    if (this.projects.getCurrentProject()?.path !== path) throw new Error('The project changed. Run the health check again.');
  }

  /** Confirmation is owned here, so every UI caller has the same protection. */
  async repair(finding: HealthFinding): Promise<boolean> {
    const fix = finding.fix;
    const project = this.projects.getCurrentProject();
    if (!fix || !project) return false;
    // Capture the exact source before confirmation: names and every matching line
    // are user-authored content, and must not change underneath the preview.
    let planSource: string | undefined;
    let planPreview = '';
    if (fix.kind === 'plan') {
      const read = await this.electron.readFile(pathJoin(project.path, fix.field));
      this.assertProject(project.path);
      if (!read.success || read.content === undefined) throw new Error('Could not read the source file.');
      planSource = read.content;
      const povs = parseBookPlan(planSource).chapters.flatMap(chapter => chapter.pov).filter(pov => pov.characterId === fix.missing);
      if (!povs.length) return false;
      planPreview = '\n\nThe following entire plan lines will be removed:\n' +
        povs.map(pov => `“${planSource!.slice(pov.from, pov.to).replace(/\r$/, '')}”`).join('\n');
    }
    if (!(await this.modal.confirm(`Remove orphaned ID “${fix.missing}” from ${finding.name}?${fix.kind === 'pinboard' && fix.field === 'Nodes' ? ' Connections to this node will also be removed.' : ''}${planPreview}`,
      'Remove orphaned ID', { confirmText: 'Remove ID', danger: true }))) return false;
    this.assertProject(project.path);
    // Re-run after the dialog: an external edit may have restored the target or changed the source.
    const current = await this.scan();
    if (!current.some(item => item.fix && JSON.stringify(item.fix) === JSON.stringify(fix))) return false;
    this.assertProject(project.path);
    const keep = (id: string) => id !== fix.missing;
    switch (fix.kind) {
      case 'house': {
        const house = (await this.houses.readHealthSnapshot()).find(item => item.id === fix.owner);
        if (!house) return false;
        await this.houses.removeOrphanedId(house, fix.field, fix.missing);
        break;
      }
      case 'cast':
        await this.casts.removeOrphanedId(fix.owner, fix.field, fix.missing);
        break;
      case 'pinboard': {
        const board = this.projects.getCurrentProject()?.metadata.pinboards?.find(item => item.id === fix.owner);
        if (!board) return false;
        await this.projects.updatePinboardById(board.id, {
          nodes: fix.field === 'Nodes' ? board.nodes.filter(node => keep(node.id)) : board.nodes,
          edges: board.edges.filter(edge => fix.field === 'Nodes' ? keep(edge.source) && keep(edge.target) : edge.id !== fix.field.slice(5)),
        });
        break;
      }
      case 'pov': {
        const book = this.projects.getCurrentProject()?.metadata.books.find(item => item.id === fix.owner);
        if (!book) return false;
        await this.metadata.updateBook(book.id, { povCharacterIds: book.povCharacterIds?.filter(keep) });
        break;
      }
      case 'thread':
      case 'plan': {
        const relative = fix.kind === 'thread' ? fix.owner : fix.field;
        const path = pathJoin(project.path, relative);
        const read = await this.electron.readFile(path);
        if (!read.success || read.content === undefined) throw new Error('Could not read the source file.');
        let content: string;
        if (fix.kind === 'thread') {
          const board = this.boards.parseFile(read.content);
          board.threads = board.threads.map(thread => thread.id === fix.field ? { ...thread, characters: thread.characters.filter(keep) } : thread);
          content = this.boards.generateFile(board);
        } else {
          if (read.content !== planSource) throw new Error('The file changed. Run the health check again.');
          content = read.content;
          const povs = parseBookPlan(content).chapters.flatMap(chapter => chapter.pov).filter(pov => pov.characterId === fix.missing);
          for (const pov of povs.sort((a, b) => b.from - a.from)) content = content.slice(0, pov.from) + content.slice(pov.to).replace(/^\r?\n/, '');
        }
        const latest = await this.electron.readFile(path);
        this.assertProject(project.path);
        if (!latest.success || latest.content !== read.content) throw new Error('The file changed. Run the health check again.');
        const result = await this.electron.writeFileAtomic(path, content);
        if (!result.success) throw new Error(result.error || 'Could not save the repair.');
        if (fix.kind === 'plan') {
          const original = read.content;
          let restored = false;
          this.notifications.showUndo(`Removed orphaned PoV lines from ${finding.name}.`, async () => {
            if (restored) return;
            try {
              this.assertProject(project.path);
              const latest = await this.electron.readFile(path);
              this.assertProject(project.path);
              if (!latest.success || latest.content !== content) throw new Error('The plan changed since the repair.');
              const result = await this.electron.writeFileAtomic(path, original);
              if (!result.success) throw new Error(result.error || 'Could not restore the plan.');
              restored = true;
            } catch (error) {
              this.notifications.showError(`Could not undo PoV removal: ${error instanceof Error ? error.message : error}`);
            }
          }, UNDO_WINDOW_MS);
        }
        break;
      }
    }
    return true;
  }
}
