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
import { rewriteRenamedLinks } from '../utils/wiki-link-rename.utils';

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

  /** Capture resolution before the rename, then scan the saved descriptions and book pages. */
  async run<T extends RenameRecord | null>(old: RenameRecord, name: string, route: WikiLinkRoute | 'character-draft', save: () => Promise<T>): Promise<T> {
    if (old.name === name) return save();
    const project = this.projects.getCurrentProject();
    if (!project) throw new Error('Select a project first.');
    const before = await firstValueFrom(this.targets.targets$(route === 'character-draft' ? 'character' : route));
    const saved = await save();
    if (!saved) return saved;
    const assertProject = () => {
      if (this.projects.getCurrentProject()?.path !== project.path) throw new Error('The project changed.');
    };
    assertProject();
    const after = await firstValueFrom(this.targets.targets$(route === 'character-draft' ? 'character' : route));
    const named = after.resolve(saved.name);
    const folder = route === 'character' || route === 'character-draft' ? project.metadata.settings?.charactersFolder || 'characters'
      : route === 'location' ? project.metadata.settings?.locationsFolder || 'locations' : 'houses';
    const replacement = named.state === 'resolved' && named.id === saved.id && named.route === route && !/[#|\[\]]/.test(saved.name)
      ? saved.name : `${folder}/${saved.relativePath.replace(/\.md$/i, '')}`;
    const scan = await this.electron.readDirectoryRecursive(project.path, '*.md');
    if (!scan.success || !scan.files) throw new Error(scan.error || 'Unable to scan wiki links.');
    const changes: { path: string; expected: string; content: string }[] = [];
    const previews: string[] = [];
    let count = 0;
    for (const file of scan.files) {
      if (file.relativePath.replace(/\\/g, '/').split('/').some(part => part === '.ensemble-trash' || part === '.git' || part === 'node_modules')) continue;
      const read = await this.electron.readFile(file.absolutePath);
      if (!read.success || read.content === undefined) throw new Error(read.error || `Unable to read ${file.relativePath}`);
      const raw = read.content;
      // Preserve frontmatter verbatim; image paths and other metadata are not prose links.
      const prefix = raw.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] || '';
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
