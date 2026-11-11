import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withHashLocation, RouteReuseStrategy } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { MapRouteReuseStrategy } from './core/services/map-route-reuse.strategy';
import { routes } from './app.routes';

// Core Services
import { CharacterService, ProjectService, PinboardService, FileWatcherService } from './core/services';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true, runCoalescing: true }),
    provideRouter(routes, withHashLocation()),
    { provide: RouteReuseStrategy, useClass: MapRouteReuseStrategy },
    provideAnimations(),
    importProvidersFrom(FormsModule, ReactiveFormsModule),
    CharacterService,
    ProjectService,
    PinboardService,
    FileWatcherService
  ]
};