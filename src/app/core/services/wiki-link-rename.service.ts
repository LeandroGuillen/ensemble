import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { ModalService } from './modal.service';
import { WikiLinkTargetsService, WikiLinkRoute } from './wiki-link-targets.service';
import { CharacterService } from './character.service';
import { LocationService } from './location.service';
import { HouseService } from './house.service';
import { generateMarkdown, parseMarkdown } from '../utils/markdown.utils';
import { normalizeAliases } from '../utils/character-alias.utils';
import { collectionsAfterRename, conflictKey, countRetargetedLinks, findRenameConflicts, RetargetCount, rewriteRenamedLinks } from '../utils/wiki-link-rename.utils';
import { buildWikiLinkTargets, WikiLinkTargets } from '../utils/wiki-links.utils';
import { Project } from '../interfaces/project.interface';

/**
 * Thrown by `WikiLinkRenameService.run()` when the user cancels a rename to a name that already
 * belongs to another record. Nothing was saved; callers should stop quietly.
 */
export class RenameCancelledError extends Error {
  constructor() { super('Rename cancelled.'); this.name = 'RenameCancelledError'; }
}

const ROUTE_NOUN: Record<string, string> = { character: 'character', 'character-draft': 'draft', location: 'location', house: 'House' };

interface RenameRecord { id: string; name: string; filePath: string; relativePath: string; content: string; aliases?: string[]; raw?: string; }

@Injectable({ providedIn: 'root' })
export class WikiLinkRenameService {
  private injector = inject(Injector);
  private get electron() { return this.injector.get(ElectronService); }
  private get projects() { return this.injector.get(ProjectService); }
  private get modal() { return this.injector.get(ModalService); }
  private get targets() { return this.injector.get(WikiLinkTargetsService); }
  private get characters() { return this.injector.get(CharacterService); }
  private get locations() { return this.injector.get(LocationService); }
  private get houses() { return this.injector.get(HouseService); }

  /** Markdown files whose prose may hold links (skips the staged trash, `.git` and `node_modules`). */
  private async proseFiles(project: Project): Promise<{ relativePath: string; absolutePath: string }[]> {
    const scan = await this.electron.readDirectoryRecursive(project.path, '*.md');
    if (!scan.success || !scan.files) throw new Error(scan.error || 'Unable to scan wiki links.');
    return scan.files.filter(file => !file.relativePath.replace(/\\/g, '/').split('/').some(part => part === '.ensemble-trash' || part === '.git' || part === 'node_modules'));
  }

  private async readProse(file: { relativePath: string; absolutePath: string }): Promise<{ raw: string; prefix: string }> {
    const read = await this.electron.readFile(file.absolutePath);
    if (!read.success || read.content === undefined) throw new Error(read.error || `Unable to read ${file.relativePath}`);
    const raw = read.content;
    // Preserve frontmatter verbatim; image paths and other metadata are not prose links.
    return { raw, prefix: raw.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] || '' };
  }

  /**
   * Before saving, warn when `name` is already another record's name or alias: links that open
   * that record through the name would silently start opening this one (or become ambiguous).
   * Throws `RenameCancelledError` when the user cancels.
   */
  private async confirmConflicts(project: Project, before: WikiLinkTargets, old: RenameRecord, name: string, route: string): Promise<void> {
    const collections = before.collections;
    if (!collections) return;
    const conflicts = findRenameConflicts(collections, route, old.id, name);
    if (!conflicts.length) return;
    const after = buildWikiLinkTargets(collectionsAfterRename(collections, route, old.id, name));
    const counts = new Map<string, RetargetCount>();
    for (const file of await this.proseFiles(project)) {
      const { raw, prefix } = await this.readProse(file);
      countRetargetedLinks(raw.slice(prefix.length), before, after, conflicts, old.id, route, counts);
    }
    const noun = ROUTE_NOUN[route] || 'record';
    const links = (n: number) => `${n} link${n === 1 ? '' : 's'}`;
    const lines = conflicts.map(conflict => {
      const { retarget, lost } = counts.get(conflictKey(conflict)) || { retarget: 0, lost: 0 };
      const what = conflict.via === 'alias' ? 'an alias of' : 'the name of';
      const effects = [
        ...(retarget || !lost ? [`${links(retarget)} to ${conflict.name} will point to this ${noun} instead.`] : []),
        ...(lost ? [`${links(lost)} to ${conflict.name} will no longer resolve (ambiguous).`] : []),
      ];
      return `"${name.trim()}" is ${what} ${conflict.name} (${conflict.singular}). ${effects.join(' ')}`;
    });
    const ok = await this.modal.confirm(
      `${lines.join('\n\n')}\n\nCancel keeps "${old.name}" and saves nothing.`,
      'Name already in use',
      { confirmText: 'Rename anyway', cancelText: 'Cancel' }
    );
    if (!ok) throw new RenameCancelledError();
  }

  /**
   * Capture resolution before the rename, then scan the saved descriptions and book pages.
   * Throws `RenameCancelledError` (nothing saved) when the new name belongs to another record
   * and the user cancels the warning.
   */
  async run<T extends RenameRecord | null>(old: RenameRecord, name: string, route: WikiLinkRoute | 'character-draft', save: () => Promise<T>): Promise<T> {
    if (old.name === name) return save();
    const project = this.projects.getCurrentProject();
    if (!project) throw new Error('Select a project first.');
    const assertProject = () => {
      if (this.projects.getCurrentProject()?.path !== project.path) throw new Error('The project changed.');
    };
    const before = await firstValueFrom(this.targets.targets$(route === 'character-draft' ? 'character' : route));
    await this.confirmConflicts(project, before, old, name, route);
    assertProject();
    const saved = await save();
    if (!saved) return saved;
    assertProject();
    const after = await firstValueFrom(this.targets.targets$(route === 'character-draft' ? 'character' : route));
    const named = after.resolve(saved.name);
    const folder = route === 'character' || route === 'character-draft' ? project.metadata.settings?.charactersFolder || 'characters'
      : route === 'location' ? project.metadata.settings?.locationsFolder || 'locations' : 'houses';
    const replacement = named.state === 'resolved' && named.id === saved.id && named.route === route && !/[#|\[\]]/.test(saved.name)
      ? saved.name : `${folder}/${saved.relativePath.replace(/\.md$/i, '')}`;
    const changes: { path: string; expected: string; content: string }[] = [];
    const previews: string[] = [];
    let count = 0;
    for (const file of await this.proseFiles(project)) {
      const { raw, prefix } = await this.readProse(file);
      const rewrite = rewriteRenamedLinks(raw.slice(prefix.length), before, after, old.id, route, replacement);
      if (!rewrite.count) continue;
      count += rewrite.count;
      changes.push({ path: file.absolutePath, expected: raw, content: prefix + rewrite.content });
      const originalLines = raw.slice(prefix.length).split('\n');
      const updatedLines = rewrite.content.split('\n');
      const preview = originalLines.flatMap((line, index) => line !== updatedLines[index] ? [`${line}\n→ ${updatedLines[index]}`] : []).slice(0, 3).join('\n');
      previews.push(`${file.relativePath} (${rewrite.count})\n${preview}`);
    }
    if (!count) return saved;
    const choice = await this.modal.confirmLinkRename(`Update ${count} links in ${changes.length} files?\n\n${previews.join('\n\n')}`);
    assertProject();
    if (!choice.update) return saved;
    if (choice.alias) {
      let change = changes.find(item => item.path === saved.filePath);
      if (!change) {
        const read = await this.electron.readFile(saved.filePath);
        if (!read.success || read.content === undefined) throw new Error(read.error || 'Unable to read renamed record.');
        change = { path: saved.filePath, expected: read.content, content: read.content };
        changes.push(change);
      }
      const parsed = parseMarkdown<Record<string, unknown>>(change.content);
      if (!parsed.success) throw new Error(parsed.error);
      const fm = parsed.data!.frontmatter;
      fm['aliases'] = normalizeAliases([...normalizeAliases(fm['aliases']), old.name]);
      change.content = generateMarkdown(fm, parsed.data!.content);
    }
    const result = await this.electron.rewriteWikiLinks(changes);
    if (!result.success) throw new Error(result.error || 'Unable to update wiki links.');
    const own = changes.find(item => item.path === saved.filePath);
    if (own) {
      const parsed = parseMarkdown<Record<string, unknown>>(own.content).data!;
      saved.content = parsed.content;
      saved.aliases = normalizeAliases(parsed.frontmatter['aliases']);
      if ('raw' in saved) saved.raw = own.content;
    }
    await Promise.all([this.characters.forceReloadCharacters(), this.locations.forceReloadLocations(), this.houses.loadHouses(true)]);
    return saved;
  }
}
