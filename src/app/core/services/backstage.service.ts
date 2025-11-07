import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { BackstageData, CharacterConcept, NameList } from '../interfaces/backstage.interface';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';

@Injectable({
  providedIn: 'root',
})
export class BackstageService {
  private backstageData$ = new BehaviorSubject<BackstageData>({
    concepts: [],
    nameLists: [],
  });

  private currentProjectPath: string | null = null;

  constructor(private electronService: ElectronService, private projectService: ProjectService) {
    // Subscribe to project changes
    this.projectService.currentProject$.subscribe((project) => {
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

  private getCharactersFolderPath(): string {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }
    return `${this.currentProjectPath}/characters`;
  }

  private getConceptsFilePath(): string {
    return `${this.getCharactersFolderPath()}/concepts.md`;
  }

  private getNameListsFilePath(): string {
    return `${this.getCharactersFolderPath()}/names.md`;
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
      console.error('Failed to load backstage data:', error);
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
        return `## ${title}\n\n${concept.notes}\n`;
      })
      .join('\n');

    const filePath = this.getConceptsFilePath();
    const result = await this.electronService.writeFile(filePath, content);

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
    const sections = content.split(/^## /m).filter((s) => s.trim());

    for (const section of sections) {
      const lines = section.split('\n');
      const titleLine = lines[0].trim();

      // Parse names from list items
      const names: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ')) {
          names.push(trimmed.substring(2).trim());
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
        const nameItems = list.names.map((name) => `- ${name}`).join('\n');
        return `# ${list.title}\n\n${nameItems}\n`;
      })
      .join('\n');

    const filePath = this.getNameListsFilePath();
    const result = await this.electronService.writeFile(filePath, content);

    if (!result.success) {
      throw new Error(result.error || 'Failed to write name lists file');
    }
  }

  // Concept methods
  async addConcept(concept: CharacterConcept): Promise<void> {
    const data = this.backstageData$.value;
    data.concepts.push(concept);
    await this.saveConcepts(data.concepts);
    this.backstageData$.next(data);
  }

  async updateConcept(index: number, updates: Partial<CharacterConcept>): Promise<void> {
    const data = this.backstageData$.value;
    if (index < 0 || index >= data.concepts.length) {
      throw new Error('Concept not found');
    }

    data.concepts[index] = {
      ...data.concepts[index],
      ...updates,
    };

    await this.saveConcepts(data.concepts);
    this.backstageData$.next(data);
  }

  async deleteConcept(index: number): Promise<void> {
    const data = this.backstageData$.value;
    data.concepts.splice(index, 1);
    await this.saveConcepts(data.concepts);
    this.backstageData$.next(data);
  }

  // Name list methods
  async addNameList(nameList: NameList): Promise<void> {
    const data = this.backstageData$.value;
    data.nameLists.push(nameList);
    await this.saveNameLists(data.nameLists);
    this.backstageData$.next(data);
  }

  async updateNameList(index: number, updates: Partial<NameList>): Promise<void> {
    const data = this.backstageData$.value;
    if (index < 0 || index >= data.nameLists.length) {
      throw new Error('Name list not found');
    }

    data.nameLists[index] = {
      ...data.nameLists[index],
      ...updates,
    };

    await this.saveNameLists(data.nameLists);
    this.backstageData$.next(data);
  }

  async deleteNameList(index: number): Promise<void> {
    const data = this.backstageData$.value;
    data.nameLists.splice(index, 1);
    await this.saveNameLists(data.nameLists);
    this.backstageData$.next(data);
  }
}
