import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable } from 'rxjs';
import { BackstageData, CharacterConcept, NameList } from '../interfaces/backstage.interface';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';

@Injectable({
  providedIn: 'root',
})
export class BackstageService {
  private backstageData$ = new BehaviorSubject<BackstageData>({
    concepts: [],
    nameLists: [],
  });

  private currentProjectPath: string | null = null;

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService,
    private logger: LoggingService
  ) {
    // Subscribe to project changes
    this.projectService.currentProject$.pipe(takeUntilDestroyed()).subscribe((project) => {
      if (project) {
        this.currentProjectPath = project.path;
        this.loadBackstageData();
      } else {
        this.currentProjectPath = null;
        this.backstageData$.next({ concepts: [], nameLists: [] });
      }
    });
  }

  getBackstageData(): Observable<BackstageData> {
    return this.backstageData$.asObservable();
  }

  getCurrentProjectPath(): string | null {
    return this.currentProjectPath;
  }

  private getCharactersFolderPath(): string {
    return this.projectService.getCharactersFolderPath();
  }

  private getConceptsFilePath(): string {
    return `${this.getCharactersFolderPath()}/concepts.md`;
  }

  private getNameListsFilePath(): string {
    return this.projectService.getNamesFilePath();
  }

  /** Absolute path to the names file (for opening in external editor, etc.). */
  getNamesFilePath(): string {
    return this.projectService.getNamesFilePath();
  }

  async loadBackstageData(): Promise<void> {
    if (!this.currentProjectPath) return;

    try {
      // Ensure characters folder exists
      const folderPath = this.getCharactersFolderPath();
      const folderExists = await this.electronService.fileExists(folderPath);
      if (!folderExists) {
        await this.electronService.createDirectory(folderPath);
      }

      // Load concepts
      const concepts = await this.loadConcepts();

      // Load name lists
      const nameLists = await this.loadNameLists();

      this.backstageData$.next({ concepts, nameLists });
    } catch (error) {
      this.logger.error('Failed to load backstage data', error);
      this.backstageData$.next({ concepts: [], nameLists: [] });
    }
  }

  private async loadConcepts(): Promise<CharacterConcept[]> {
    const filePath = this.getConceptsFilePath();
    const exists = await this.electronService.fileExists(filePath);

    if (!exists) {
      return [];
    }

    const result = await this.electronService.readFile(filePath);
    if (!result.success || !result.content) {
      return [];
    }

    return this.parseConceptsMarkdown(result.content);
  }

  private parseConceptsMarkdown(content: string): CharacterConcept[] {
    const concepts: CharacterConcept[] = [];
    const sections = content.split(/^# /m).filter((s) => s.trim());

    for (const section of sections) {
      const lines = section.split('\n');
      const titleLine = lines[0].trim();

      // Get notes (everything after title)
      const notes = lines.slice(1).join('\n').trim();

      concepts.push({
        title: titleLine || undefined,
        notes,
      });
    }

    return concepts;
  }

  private async saveConcepts(concepts: CharacterConcept[]): Promise<void> {
    const content = concepts
      .map((concept) => {
        const title = concept.title || 'Untitled Concept';
        return `# ${title}\n\n${concept.notes}\n`;
      })
      .join('\n');

    const filePath = this.getConceptsFilePath();
    const result = await this.electronService.writeFileAtomic(filePath, content);

    if (!result.success) {
      throw new Error(result.error || 'Failed to write concepts file');
    }
  }

  private async loadNameLists(): Promise<NameList[]> {
    const filePath = this.getNameListsFilePath();
    const exists = await this.electronService.fileExists(filePath);

    if (!exists) {
      return [];
    }

    const result = await this.electronService.readFile(filePath);
    if (!result.success || !result.content) {
      return [];
    }

    return this.parseNameListsMarkdown(result.content);
  }

  private parseNameListsMarkdown(content: string): NameList[] {
    const nameLists: NameList[] = [];
    // Try double hash first (preferred format), fall back to single hash for compatibility
    let sections = content.split(/^## /m).filter((s) => s.trim());

    // If no double-hash sections found, try single hash (old format)
    if (sections.length <= 1 && content.includes('#')) {
      sections = content.split(/^# /m).filter((s) => s.trim());
    }

    for (const section of sections) {
      const lines = section.split('\n');
      const titleLine = lines[0].trim();

      // Parse names with notes from list items
      const names: Array<{ name: string; notes?: string }> = [];
      let i = 1; // Start after title line
      
      while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        
        // Check if this is a main bullet (starts with `- ` and is not indented)
        if (trimmed.startsWith('- ') && !line.startsWith(' ') && !line.startsWith('\t')) {
          const name = trimmed.substring(2).trim();
          const notes: string[] = [];
          
          // Collect following indented lines as notes
          i++;
          while (i < lines.length) {
            const nextLine = lines[i];
            const nextTrimmed = nextLine.trim();
            
            // Check if this is an indented bullet (2+ spaces or tab + `- `)
            const isIndented = (nextLine.startsWith('  ') || nextLine.startsWith('\t')) && 
                               nextTrimmed.startsWith('- ');
            
            if (isIndented) {
              // Extract note text (remove bullet marker)
              const noteText = nextTrimmed.substring(2).trim();
              if (noteText) {
                notes.push(noteText);
              }
              i++;
            } else if (nextLine.trim() === '' || nextTrimmed.startsWith('- ')) {
              // Empty line or next main bullet - stop collecting notes
              break;
            } else if (nextLine.startsWith(' ') || nextLine.startsWith('\t')) {
              // Continuation of previous note (indented but not a bullet)
              const noteText = nextTrimmed;
              if (noteText) {
                if (notes.length > 0) {
                  notes[notes.length - 1] += ' ' + noteText;
                } else {
                  notes.push(noteText);
                }
              }
              i++;
            } else {
              // Non-indented, non-bullet line - stop collecting
              break;
            }
          }
          
          // Add tab prefix to each note line for internal storage
          const notesWithTabs = notes.length > 0 
            ? notes.map(note => note.startsWith('\t') ? note : `\t${note}`).join('\n')
            : undefined;
          
          names.push({
            name,
            notes: notesWithTabs,
          });
        } else {
          i++;
        }
      }

      nameLists.push({
        title: titleLine,
        names,
      });
    }

    return nameLists;
  }

  private async saveNameLists(nameLists: NameList[]): Promise<void> {
    const content = nameLists
      .map((list) => {
        const nameItems = list.names
          .map((nameItem) => {
            let result = `- ${nameItem.name}`;
            if (nameItem.notes) {
              // Split notes by newlines and add as indented bullets
              // Use tab character for indentation in markdown
              const noteLines = nameItem.notes.split('\n').filter((n) => n.trim());
              if (noteLines.length > 0) {
                const indentedNotes = noteLines.map((note) => {
                  // Remove leading tab if present, then add markdown indentation with tab
                  const cleanedNote = note.startsWith('\t') ? note.substring(1) : note;
                  return `\t- ${cleanedNote.trim()}`;
                }).join('\n');
                result += '\n' + indentedNotes;
              }
            }
            return result;
          })
          .join('\n');
        return `## ${list.title}\n\n${nameItems}\n`;
      })
      .join('\n');

    const filePath = this.getNameListsFilePath();
    const result = await this.electronService.writeFileAtomic(filePath, content);

    if (!result.success) {
      throw new Error(result.error || 'Failed to write name lists file');
    }
  }

  // Concept methods
  async addConcept(concept: CharacterConcept): Promise<void> {
    const data = this.backstageData$.value;
    const concepts = [...data.concepts, concept];
    await this.saveConcepts(concepts);
    this.backstageData$.next({ ...data, concepts });
  }

  async updateConcept(index: number, updates: Partial<CharacterConcept>): Promise<void> {
    const data = this.backstageData$.value;
    if (index < 0 || index >= data.concepts.length) {
      throw new Error('Concept not found');
    }

    const concepts = [...data.concepts];
    concepts[index] = {
      ...data.concepts[index],
      ...updates,
    };

    await this.saveConcepts(concepts);
    this.backstageData$.next({ ...data, concepts });
  }

  async deleteConcept(index: number): Promise<void> {
    const data = this.backstageData$.value;
    const concepts = data.concepts.filter((_, i) => i !== index);
    await this.saveConcepts(concepts);
    this.backstageData$.next({ ...data, concepts });
  }

  // Name list methods
  async addNameList(nameList: NameList): Promise<void> {
    const data = this.backstageData$.value;
    // Ensure names array has the correct structure
    const normalizedNameList: NameList = {
      title: nameList.title,
      names: nameList.names.map((name) => 
        typeof name === 'string' 
          ? { name } 
          : name
      ),
    };
    const nameLists = [...data.nameLists, normalizedNameList];
    await this.saveNameLists(nameLists);
    this.backstageData$.next({ ...data, nameLists });
  }

  async updateNameList(index: number, updates: Partial<NameList>): Promise<void> {
    const data = this.backstageData$.value;
    if (index < 0 || index >= data.nameLists.length) {
      throw new Error('Name list not found');
    }

    const nameLists = [...data.nameLists];
    nameLists[index] = {
      ...data.nameLists[index],
      ...updates,
    };

    await this.saveNameLists(nameLists);
    this.backstageData$.next({ ...data, nameLists });
  }

  async deleteNameList(index: number): Promise<void> {
    const data = this.backstageData$.value;
    const nameLists = data.nameLists.filter((_, i) => i !== index);
    await this.saveNameLists(nameLists);
    this.backstageData$.next({ ...data, nameLists });
  }

  /** Appends a name to an existing list. */
  async addNameToList(listIndex: number, name: string, notes?: string): Promise<void> {
    const data = this.backstageData$.value;
    if (listIndex < 0 || listIndex >= data.nameLists.length) {
      throw new Error('Name list not found');
    }

    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Name cannot be empty');
    }

    const list = data.nameLists[listIndex];
    const names = [...list.names, { name: trimmed, ...(notes ? { notes } : {}) }];
    await this.updateNameList(listIndex, { names });
  }

  /** Snapshot of current name lists (for pickers / command actions). */
  getNameLists(): NameList[] {
    return this.backstageData$.value.nameLists;
  }
}
