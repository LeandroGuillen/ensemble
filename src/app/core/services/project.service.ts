import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Project, ProjectMetadata, Category, Tag } from '../interfaces/project.interface';

@Injectable({
  providedIn: 'root'
})
export class ProjectService {
  private currentProjectSubject = new BehaviorSubject<Project | null>(null);
  public currentProject$ = this.currentProjectSubject.asObservable();

  constructor() {}

  getCurrentProject(): Project | null {
    return this.currentProjectSubject.value;
  }

  async selectProject(): Promise<string | null> {
    // TODO: Implement Electron dialog integration
    console.log('Opening project selection dialog');
    return null;
  }

  async loadProject(projectPath: string): Promise<Project | null> {
    // TODO: Implement project loading from file system
    console.log('Loading project from:', projectPath);
    
    // Mock project for now
    const mockProject: Project = {
      path: projectPath,
      metadata: {
        projectName: 'Sample Project',
        version: '1.0.0',
        categories: [
          { id: 'main-character', name: 'Main Character', color: '#3498db' },
          { id: 'supporting', name: 'Supporting Character', color: '#2ecc71' }
        ],
        tags: [
          { id: 'protagonist', name: 'Protagonist', color: '#e74c3c' },
          { id: 'magic-user', name: 'Magic User', color: '#9b59b6' }
        ],
        settings: {
          defaultCategory: 'main-character',
          autoSave: true,
          fileWatchEnabled: true
        }
      }
    };
    
    this.currentProjectSubject.next(mockProject);
    return mockProject;
  }

  async createProject(projectPath: string, projectName: string): Promise<Project | null> {
    // TODO: Implement project creation
    console.log('Creating project at:', projectPath, 'with name:', projectName);
    
    const defaultMetadata: ProjectMetadata = {
      projectName,
      version: '1.0.0',
      categories: [
        { id: 'main-character', name: 'Main Character', color: '#3498db' },
        { id: 'supporting', name: 'Supporting Character', color: '#2ecc71' },
        { id: 'antagonist', name: 'Antagonist', color: '#e74c3c' }
      ],
      tags: [
        { id: 'protagonist', name: 'Protagonist', color: '#e74c3c' },
        { id: 'magic-user', name: 'Magic User', color: '#9b59b6' },
        { id: 'noble', name: 'Noble', color: '#f39c12' }
      ],
      settings: {
        defaultCategory: 'main-character',
        autoSave: true,
        fileWatchEnabled: true
      }
    };
    
    const project: Project = {
      path: projectPath,
      metadata: defaultMetadata
    };
    
    this.currentProjectSubject.next(project);
    return project;
  }

  getCategories(): Category[] {
    const project = this.currentProjectSubject.value;
    return project?.metadata.categories || [];
  }

  getTags(): Tag[] {
    const project = this.currentProjectSubject.value;
    return project?.metadata.tags || [];
  }

  async addCategory(category: Omit<Category, 'id'>): Promise<Category | null> {
    // TODO: Implement category addition
    const project = this.currentProjectSubject.value;
    if (!project) return null;
    
    const newCategory: Category = {
      id: this.generateId(),
      ...category
    };
    
    project.metadata.categories.push(newCategory);
    this.currentProjectSubject.next({ ...project });
    
    return newCategory;
  }

  async addTag(tag: Omit<Tag, 'id'>): Promise<Tag | null> {
    // TODO: Implement tag addition
    const project = this.currentProjectSubject.value;
    if (!project) return null;
    
    const newTag: Tag = {
      id: this.generateId(),
      ...tag
    };
    
    project.metadata.tags.push(newTag);
    this.currentProjectSubject.next({ ...project });
    
    return newTag;
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}