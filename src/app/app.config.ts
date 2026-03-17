import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { routes } from './app.routes';

// Core Services
import { CharacterService, ProjectService, PinboardService, FileWatcherService } from './core/services';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true, runCoalescing: true }),
    provideRouter(routes),
    provideAnimations(),
    importProvidersFrom(FormsModule, ReactiveFormsModule),
    CharacterService,
    ProjectService,
    PinboardService,
    FileWatcherService
  ]
};