import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ProjectService } from '../../core/services';

@Component({
  selector: 'app-project-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './project-selector.component.html',
  styleUrls: ['./project-selector.component.scss']
})
export class ProjectSelectorComponent implements OnInit {
  isLoading = false;
  error: string | null = null;

  constructor(
    private projectService: ProjectService,
    private router: Router
  ) {}

  ngOnInit(): void {}

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
      this.error = 'Failed to select project folder.';
      console.error('Project selection error:', error);
    } finally {
      this.isLoading = false;
    }
  }

  async createNewProject(): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      const projectPath = await this.projectService.selectProject();
      if (projectPath) {
        const projectName = prompt('Enter project name:');
        if (projectName) {
          const project = await this.projectService.createProject(projectPath, projectName);
          if (project) {
            this.router.navigate(['/characters']);
          } else {
            this.error = 'Failed to create project.';
          }
        }
      }
    } catch (error) {
      this.error = 'Failed to create project.';
      console.error('Project creation error:', error);
    } finally {
      this.isLoading = false;
    }
  }
}