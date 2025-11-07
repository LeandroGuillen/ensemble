import { Routes } from "@angular/router";
import { projectGuard } from "./core/guards/project.guard";

export const routes: Routes = [
  // Don't redirect '' immediately - let app.component handle initial navigation
  { path: "", pathMatch: "full", children: [] },
  {
    path: "project-selector",
    loadComponent: () =>
      import("./features/project-selector/project-selector.component").then(
        (m) => m.ProjectSelectorComponent
      ),
  },
  {
    path: "characters",
    loadComponent: () =>
      import("./features/character-list/character-list.component").then(
        (m) => m.CharacterListComponent
      ),
    canActivate: [projectGuard],
  },
  {
    path: "character/:id",
    loadComponent: () =>
      import("./features/character-detail/character-detail.component").then(
        (m) => m.CharacterDetailComponent
      ),
    canActivate: [projectGuard],
  },
  {
    path: "character",
    loadComponent: () =>
      import("./features/character-detail/character-detail.component").then(
        (m) => m.CharacterDetailComponent
      ),
    canActivate: [projectGuard],
  },
  {
    path: "graph",
    loadComponent: () =>
      import("./features/graph-view/graph-view.component").then(
        (m) => m.GraphViewComponent
      ),
    canActivate: [projectGuard],
  },
  {
    path: "metadata",
    loadComponent: () =>
      import(
        "./features/metadata-management/metadata-management.component"
      ).then((m) => m.MetadataManagementComponent),
    canActivate: [projectGuard],
  },
  {
    path: "ai-settings",
    loadComponent: () =>
      import("./features/ai-settings/ai-settings.component").then(
        (m) => m.AiSettingsComponent
      ),
    canActivate: [projectGuard],
  },
  {
    path: "library",
    loadComponent: () =>
      import("./features/library-management/library-management.component").then(
        (m) => m.LibraryManagementComponent
      ),
    canActivate: [projectGuard],
  },
  {
    path: "backstage",
    loadComponent: () =>
      import("./features/backstage/backstage.component").then(
        (m) => m.BackstageComponent
      ),
    canActivate: [projectGuard],
  },
  {
    path: "casts",
    loadComponent: () =>
      import("./features/cast-list/cast-list.component").then(
        (m) => m.CastListComponent
      ),
    canActivate: [projectGuard],
  },
  {
    path: "cast/:id",
    loadComponent: () =>
      import("./features/cast-detail/cast-detail.component").then(
        (m) => m.CastDetailComponent
      ),
    canActivate: [projectGuard],
  },
  { path: "**", redirectTo: "/project-selector" },
];
