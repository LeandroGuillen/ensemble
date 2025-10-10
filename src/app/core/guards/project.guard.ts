import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { ProjectService } from '../services/project.service';

export const projectGuard = () => {
  const projectService = inject(ProjectService);
  const router = inject(Router);

  const currentProject = projectService.getCurrentProject();

  if (!currentProject) {
    // Redirect to project selector if no project is loaded
    router.navigate(['/project-selector']);
    return false;
  }

  return true;
};
