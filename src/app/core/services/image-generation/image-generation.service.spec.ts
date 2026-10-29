import { TestBed } from '@angular/core/testing';
import {
  buildGeneratedImagePath,
  defaultImageGenerationSettings,
  ImageGenerationService,
  normalizeRelativeDirectory,
} from './image-generation.service';
import { ElectronService } from '../electron.service';
import { ProjectService } from '../project.service';
import { ImageGenerationSettings } from '../../interfaces/project.interface';

describe('ImageGenerationService path helpers', () => {
  it('builds a project-relative generated portrait path', () => {
    const path = buildGeneratedImagePath(
      'img',
      'Dessir Galsea',
      'PNG',
      new Date(2026, 6, 13, 15, 51, 0)
    );
    expect(path).toBe('img/@new/dessir-galsea-20260713-155100.png');
  });

  it('normalizes custom image folders and unsafe extensions', () => {
    const path = buildGeneratedImagePath(
      '/art/portraits/',
      'A / B',
      '.webp',
      new Date(2026, 0, 2, 3, 4, 5)
    );
    expect(path).toBe('art/portraits/@new/a-b-20260102-030405.webp');
  });

  it('transliterates accented characters in generated portrait filenames', () => {
    const path = buildGeneratedImagePath(
      'img',
      'José García',
      'png',
      new Date(2026, 6, 13, 15, 51, 0)
    );
    expect(path).toBe('img/@new/jose-garcia-20260713-155100.png');
  });

  it('writes into the provided thumbnail directory when one is given', () => {
    const path = buildGeneratedImagePath(
      'img',
      'Dessir Galsea',
      'png',
      new Date(2026, 6, 13, 15, 51, 0),
      'img/_pjs/zzz_all_cast/'
    );
    expect(path).toBe('img/_pjs/zzz_all_cast/dessir-galsea-20260713-155100.png');
  });

  it('normalizes image-browser directories without allowing traversal', () => {
    expect(normalizeRelativeDirectory('/characters\\main/')).toBe('characters/main');
    expect(() => normalizeRelativeDirectory('../outside')).toThrowError(
      'Invalid image directory'
    );
  });
});

describe('ImageGenerationService InvokeAI default baseUrl', () => {
  let service: ImageGenerationService;
  let projectService: { getCurrentProject: jasmine.Spy };

  beforeEach(() => {
    projectService = {
      getCurrentProject: jasmine.createSpy('getCurrentProject').and.returnValue(null),
    };
    TestBed.configureTestingModule({
      providers: [
        ImageGenerationService,
        { provide: ElectronService, useValue: {} },
        { provide: ProjectService, useValue: projectService },
      ],
    });
    service = TestBed.inject(ImageGenerationService);
  });

  it('uses http://localhost:9090 when there are no saved AI settings', () => {
    projectService.getCurrentProject.and.returnValue(null);
    expect(defaultImageGenerationSettings().invokeai.baseUrl).toBe('http://localhost:9090');
    expect(service.getSettings().invokeai.baseUrl).toBe('http://localhost:9090');
  });

  it('keeps a saved InvokeAI baseUrl after load (no migration)', () => {
    const saved: ImageGenerationSettings = {
      enabled: true,
      provider: 'invokeai',
      invokeai: { baseUrl: 'http://my-invoke.lan:9090', defaultWorkflowId: 'wf-1' },
      comfyui: { baseUrl: 'http://127.0.0.1:8188' },
      openai: { apiKey: '' },
      gemini: { apiKey: '' },
    };
    projectService.getCurrentProject.and.returnValue({
      path: '/project',
      metadata: {
        settings: { imageGeneration: saved },
      },
    });

    expect(service.getSettings().invokeai.baseUrl).toBe('http://my-invoke.lan:9090');
    expect(service.getSettings().invokeai.defaultWorkflowId).toBe('wf-1');
  });
});
