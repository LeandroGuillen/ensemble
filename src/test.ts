// This file is required by karma.conf.js and loads recursively all the .spec and framework files

import { getTestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting
} from '@angular/platform-browser-dynamic/testing';

// First, initialize the Angular testing environment.
getTestBed().initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting(),
);

// Manually import all test files
// Validators
import './app/core/validators/character.validator.spec';
import './app/core/validators/project.validator.spec';
import './app/core/validators/pinboard.validator.spec';

// Services
import './app/core/services/character.service.spec';
import './app/core/services/metadata.service.spec';
import './app/core/services/project.service.spec';
import './app/core/services/file-watcher.service.spec';
import './app/features/character-detail/character-detail.external-edit.spec';

import './app/core/services/cast.service.spec';
import './app/core/utils/cast-pinboard.utils.spec';

import './app/core/services/cast-editor-session.service.spec';

import './app/features/pinboard-view/components/connection-edit-dialog/connection-edit-dialog.component.spec';

import './app/core/services/house.service.spec';
import './app/features/character-detail/character-detail.save.spec';
import './app/features/house-detail/house-detail.component.spec';
import './app/shared/character-houses/character-houses.component.spec';
