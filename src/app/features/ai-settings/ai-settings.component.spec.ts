import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AiSettingsComponent } from './ai-settings.component';
import { AiService } from '../../core/services/ai.service';
import { ImageGenerationService } from '../../core/services/image-generation/image-generation.service';
import { defaultImageGenerationSettings } from '../../core/services/image-generation/image-generation.service';

describe('AiSettingsComponent InvokeAI placeholder', () => {
  let fixture: ComponentFixture<AiSettingsComponent>;
  let imageGeneration: jasmine.SpyObj<ImageGenerationService>;

  beforeEach(async () => {
    imageGeneration = jasmine.createSpyObj('ImageGenerationService', [
      'getSettings',
      'updateSettings',
      'listWorkflows',
      'testConnection',
    ]);
    imageGeneration.getSettings.and.returnValue(defaultImageGenerationSettings());
    imageGeneration.listWorkflows.and.resolveTo([]);
    imageGeneration.testConnection.and.resolveTo({ success: true });

    await TestBed.configureTestingModule({
      imports: [AiSettingsComponent],
      providers: [
        {
          provide: AiService,
          useValue: {
            getAiSettings: () => of(null),
            updateAiSettings: () => Promise.resolve(),
            testConnection: () => Promise.resolve({ success: true }),
          },
        },
        { provide: ImageGenerationService, useValue: imageGeneration },
      ],
    }).compileComponents();

    // Defaults already have provider invokeai; enable so the URL field is rendered.
    imageGeneration.getSettings.and.returnValue({
      ...defaultImageGenerationSettings(),
      enabled: true,
    });
    fixture = TestBed.createComponent(AiSettingsComponent);
    fixture.componentInstance.activeSection = 'image-generation';
    fixture.detectChanges();
  });

  it('shows http://localhost:9090 as the InvokeAI URL placeholder', () => {
    const input = fixture.nativeElement.querySelector(
      '#invokeAiBaseUrl'
    ) as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(input!.getAttribute('placeholder')).toBe('http://localhost:9090');
  });
});
