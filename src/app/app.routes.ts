import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: '/project-selector', pathMatch: 'full' },
  { 
    path: 'project-selector', 
    loadComponent: () => import('./features/project-selector/project-selector.component').then(m => m.ProjectSelectorComponent)
  },
  { 
    path: 'characters', 
    loadComponent: () => import('./features/character-list/character-list.component').then(m => m.CharacterListComponent)
  },
  { 
    path: 'character/:id', 
    loadComponent: () => import('./features/character-detail/character-detail.component').then(m => m.CharacterDetailComponent)
  },
  { 
    path: 'character', 
    loadComponent: () => import('./features/character-detail/character-detail.component').then(m => m.CharacterDetailComponent)
  },
  { 
    path: 'graph', 
    loadComponent: () => import('./features/graph-view/graph-view.component').then(m => m.GraphViewComponent)
  },
  { path: '**', redirectTo: '/project-selector' }
];