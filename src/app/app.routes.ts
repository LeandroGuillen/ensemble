import { Routes } from '@angular/router';
import { projectGuard } from './core/guards/project.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/project-selector', pathMatch: 'full' },
  {
    path: 'project-selector',
    loadComponent: () => import('./features/project-selector/project-selector.component').then(m => m.ProjectSelectorComponent)
  },
  {
    path: 'characters',
    loadComponent: () => import('./features/character-list/character-list.component').then(m => m.CharacterListComponent),
    canActivate: [projectGuard]
  },
  {
    path: 'character/:id',
    loadComponent: () => import('./features/character-detail/character-detail.component').then(m => m.CharacterDetailComponent),
    canActivate: [projectGuard]
  },
  {
    path: 'character',
    loadComponent: () => import('./features/character-detail/character-detail.component').then(m => m.CharacterDetailComponent),
    canActivate: [projectGuard]
  },
  {
    path: 'graph',
    loadComponent: () => import('./features/graph-view/graph-view.component').then(m => m.GraphViewComponent),
    canActivate: [projectGuard]
  },
  {
    path: 'metadata',
    loadComponent: () => import('./features/metadata-management/metadata-management.component').then(m => m.MetadataManagementComponent),
    canActivate: [projectGuard]
  },
  { path: '**', redirectTo: '/project-selector' }
];