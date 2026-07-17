import { Routes } from "@angular/router";
import { projectGuard } from "./core/guards/project.guard";
import { characterPickerGuard } from "./core/guards/character-picker.guard";

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
    canDeactivate: [characterPickerGuard],
  },
  {
    path: "character",
    loadComponent: () =>
      import("./features/character-detail/character-detail.component").then(
        (m) => m.CharacterDetailComponent
      ),
    canActivate: [projectGuard],
    canDeactivate: [characterPickerGuard],
  },
  {
    path: "pinboard",
    loadComponent: () =>
      import("./features/pinboard-view/pinboard-view.component").then(
        (m) => m.PinboardViewComponent
      ),
    canActivate: [projectGuard],
  },
  {
    path: "settings",
    loadComponent: () =>
      import("./features/settings/settings.component").then(
        (m) => m.SettingsComponent
      ),
    canActivate: [projectGuard],
  },
  {
    path: "metadata",
    redirectTo: () => "/settings?section=general",
    pathMatch: "full",
  },
  {
    path: "ai-settings",
    redirectTo: () => "/settings?section=ai",
    pathMatch: "full",
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
    path: "plot-board",
    canActivate: [projectGuard],
    children: [
      {
        path: "",
        pathMatch: "full",
        loadComponent: () =>
          import("./features/plot-board/plot-board.component").then(
            (m) => m.PlotBoardComponent
          ),
      },
      {
        path: "**",
        loadComponent: () =>
          import("./features/plot-board/plot-board.component").then(
            (m) => m.PlotBoardComponent
          ),
      },
    ],
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
