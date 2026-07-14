import { Injectable } from '@angular/core';
import { ElectronService } from './electron.service';
import { LoggingService } from './logging.service';

export interface RecentProject {
  path: string;
  lastAccessed: string;
}

@Injectable({ providedIn: 'root' })
export class RecentProjectsService {
  private projects: RecentProject[] = [];

  constructor(
    private electronService: ElectronService,
    private logger: LoggingService
  ) {
    this.load().catch((error) => this.logger.error('Failed to load recent projects on init', error));
  }

  getAll(): RecentProject[] {
    return [...this.projects];
  }

  add(projectPath: string): void {
    this.projects = [
      { path: projectPath, lastAccessed: new Date().toISOString() },
      ...this.projects.filter((project) => project.path !== projectPath),
    ].slice(0, 10);
    this.save().catch((error) => this.logger.error('Failed to save recent projects', error));
  }

  remove(projectPath: string): void {
    this.projects = this.projects.filter((project) => project.path !== projectPath);
    this.save().catch((error) => this.logger.error('Failed to save recent projects', error));
  }

  clear(): void {
    this.projects = [];
    this.save().catch((error) => this.logger.error('Failed to save recent projects', error));
  }

  private async load(): Promise<void> {
    try {
      const projects = await this.electronService.getRecentProjects();
      this.projects = Array.isArray(projects)
        ? projects.filter((project) => project?.path?.trim().length > 0)
        : [];
    } catch (error) {
      this.logger.warn('Failed to load recent projects:', error);
      this.projects = [];
    }
  }

  private async save(): Promise<void> {
    try {
      const result = await this.electronService.saveRecentProjects(this.projects);
      if (!result.success) {
        this.logger.error('Failed to save recent projects', result.error);
      }
    } catch (error) {
      this.logger.warn('Failed to save recent projects:', error);
    }
  }
}
