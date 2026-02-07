import { Component, OnInit, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProjectService, ElectronService, LoggingService } from '../../core/services';

interface RecentProject {
  path: string;
  name: string;
  lastAccessed: Date;
  exists: boolean;
}

@Component({
  selector: 'app-project-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './project-selector.component.html',
  styleUrls: ['./project-selector.component.scss']
})
export class ProjectSelectorComponent implements OnInit {
  isLoading = false;
  error: string | null = null;
  recentProjects: RecentProject[] = [];
  showCreateForm = false;
  newProjectName = '';
  newProjectPath = '';
  showDuplicateForm = false;
  duplicateSourcePath: string | null = null;
  duplicateSourceName: string = '';
  duplicateProjectName = '';
  duplicateProjectPath = '';

  constructor(
    private projectService: ProjectService,
    private electronService: ElectronService,
    private router: Router,
    private logger: LoggingService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadRecentProjects();
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    // Ignore if user is typing in an input or textarea
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }

    // Ignore if in create form mode or duplicate form mode
    if (this.showCreateForm || this.showDuplicateForm) {
      return;
    }

    // Handle number keys 1-9 for recent projects
    const key = event.key;
    if (/^[1-9]$/.test(key)) {
      const index = parseInt(key, 10) - 1;
      if (index < this.recentProjects.length) {
        const project = this.recentProjects[index];
        if (project.exists) {
          event.preventDefault();
          this.openRecentProject(project.path);
        }
      }
    }
  }

  /**
   * Loads and validates recent projects
   */
  private async loadRecentProjects(): Promise<void> {
    try {
      const recentProjectsWithTimestamps = this.projectService.getRecentProjectsWithTimestamps();
      this.recentProjects = [];

      for (const { path: projectPath, lastAccessed } of recentProjectsWithTimestamps) {
        try {
          // Validate projectPath is a string
          if (typeof projectPath !== 'string' || !projectPath.trim()) {
            console.warn('Invalid project path (not a string):', projectPath);
            continue;
          }

          const exists = await this.electronService.fileExists(projectPath);
          const isDir = exists ? await this.electronService.isDirectory(projectPath) : false;
          
          // Get project name from metadata or folder name
          let projectName = await this.electronService.pathBasename(projectPath);
          if (exists && isDir) {
            try {
              const metadataPath = await this.electronService.pathJoin(projectPath, 'metadata.json');
              const hasMetadata = await this.electronService.fileExists(metadataPath);
              if (hasMetadata) {
                const result = await this.electronService.readFile(metadataPath);
                if (result.success) {
                  const metadata = JSON.parse(result.content!);
                  if (metadata.projectName) {
                    projectName = metadata.projectName;
                  }
                }
              }
            } catch (error) {
              console.warn('Failed to read project metadata:', error);
            }
          }

          this.recentProjects.push({
            path: projectPath,
            name: projectName,
            lastAccessed: lastAccessed,
            exists: exists && isDir
          });
        } catch (error) {
          console.warn('Failed to check project path:', projectPath, error);
          // Ensure projectPath is a string before calling pathBasename
          const fallbackName = typeof projectPath === 'string' 
            ? await this.electronService.pathBasename(projectPath)
            : 'Unknown Project';
          this.recentProjects.push({
            path: projectPath,
            name: fallbackName,
            lastAccessed: lastAccessed,
            exists: false
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to load recent projects:', error);
    }
  }

  /**
   * Opens an existing project from recent list
   */
  async openRecentProject(projectPath: string): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      const project = await this.projectService.loadProject(projectPath);
      if (project) {
        this.router.navigate(['/characters']);
      } else {
        this.error = 'Failed to load project. Please check the folder structure.';
      }
    } catch (error) {
      this.error = `Failed to load project: ${error}`;
      this.logger.error('Project loading error:', error);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Opens folder browser to select existing project
   */
  async selectExistingProject(): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      const projectPath = await this.projectService.selectProject();
      if (projectPath) {
        const project = await this.projectService.loadProject(projectPath);
        if (project) {
          this.router.navigate(['/characters']);
        } else {
          this.error = 'Failed to load project. Please check the folder structure.';
        }
      }
    } catch (error) {
      this.error = `Failed to select project folder: ${error}`;
      this.logger.error('Project selection error:', error);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Shows the create new project form
   */
  showCreateProjectForm(): void {
    this.showCreateForm = true;
    this.newProjectName = '';
    this.newProjectPath = '';
    this.error = null;
  }

  /**
   * Hides the create new project form
   */
  hideCreateProjectForm(): void {
    this.showCreateForm = false;
    this.newProjectName = '';
    this.newProjectPath = '';
    this.error = null;
  }

  /**
   * Opens folder browser to select location for new project
   */
  async selectNewProjectLocation(): Promise<void> {
    try {
      const selectedPath = await this.projectService.selectProject();
      if (selectedPath) {
        this.newProjectPath = selectedPath;
      }
    } catch (error) {
      this.error = `Failed to select folder: ${error}`;
      this.logger.error('Folder selection error:', error);
    }
  }

  /**
   * Creates a new project
   */
  async createNewProject(): Promise<void> {
    if (!this.newProjectName.trim()) {
      this.error = 'Please enter a project name.';
      return;
    }

    if (!this.newProjectPath.trim()) {
      this.error = 'Please select a folder for the new project.';
      return;
    }

    this.isLoading = true;
    this.error = null;

    try {
      // Create project folder path
      const sanitizedName = await this.electronService.sanitizeFilename(this.newProjectName);
      const projectPath = await this.electronService.pathJoin(this.newProjectPath, sanitizedName);

      const project = await this.projectService.createProject(projectPath, this.newProjectName);
      if (project) {
        this.router.navigate(['/characters']);
      } else {
        this.error = 'Failed to create project.';
      }
    } catch (error) {
      this.error = `Failed to create project: ${error}`;
      this.logger.error('Project creation error:', error);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Removes a project from recent projects list
   */
  removeFromRecent(projectPath: string, event: Event): void {
    event.stopPropagation();
    this.projectService.removeFromRecentProjects(projectPath);
    this.recentProjects = this.recentProjects.filter(p => p.path !== projectPath);
  }

  /**
   * Clears all recent projects
   */
  clearRecentProjects(): void {
    if (confirm('Are you sure you want to clear all recent projects?')) {
      this.projectService.clearRecentProjects();
      this.recentProjects = [];
    }
  }

  /**
   * Gets a shortened display path for UI
   */
  getDisplayPath(fullPath: string): string {
    const maxLength = 50;
    if (fullPath.length <= maxLength) {
      return fullPath;
    }
    
    // Use forward slash as separator for display (works on all platforms)
    const parts = fullPath.split(/[/\\]/);
    if (parts.length <= 2) {
      return fullPath;
    }
    
    // Show first and last parts with ellipsis
    return `${parts[0]}/.../${parts[parts.length - 1]}`;
  }

  /**
   * Formats the last accessed date for display
   */
  formatLastAccessed(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  /**
   * Initiates the duplicate project flow
   */
  startDuplicateProject(projectPath: string, projectName: string): void {
    this.showDuplicateForm = true;
    this.duplicateSourcePath = projectPath;
    this.duplicateSourceName = projectName;
    this.duplicateProjectName = `${projectName} (Copy)`;
    this.duplicateProjectPath = '';
    this.error = null;
  }

  /**
   * Cancels the duplicate project flow
   */
  cancelDuplicate(): void {
    this.showDuplicateForm = false;
    this.duplicateSourcePath = null;
    this.duplicateSourceName = '';
    this.duplicateProjectName = '';
    this.duplicateProjectPath = '';
    this.error = null;
  }

  /**
   * Opens folder browser to select destination for duplicate project
   */
  async selectDuplicateDestination(): Promise<void> {
    try {
      const selectedPath = await this.projectService.selectProject();
      if (selectedPath) {
        this.duplicateProjectPath = selectedPath;
      }
    } catch (error) {
      this.error = `Failed to select folder: ${error}`;
      this.logger.error('Folder selection error:', error);
    }
  }

  /**
   * Duplicates a project
   */
  async duplicateProject(): Promise<void> {
    if (!this.duplicateProjectName.trim()) {
      this.error = 'Please enter a project name.';
      return;
    }

    if (!this.duplicateProjectPath.trim()) {
      this.error = 'Please select a folder for the duplicate project.';
      return;
    }

    if (!this.duplicateSourcePath) {
      this.error = 'Source project path is missing.';
      return;
    }

    this.isLoading = true;
    this.error = null;

    try {
      const project = await this.projectService.duplicateProject(
        this.duplicateSourcePath,
        this.duplicateProjectPath,
        this.duplicateProjectName
      );
      
      if (project) {
        this.router.navigate(['/characters']);
      } else {
        this.error = 'Failed to duplicate project.';
      }
    } catch (error) {
      this.error = `Failed to duplicate project: ${error}`;
      this.logger.error('Project duplication error:', error);
    } finally {
      this.isLoading = false;
    }
  }
}