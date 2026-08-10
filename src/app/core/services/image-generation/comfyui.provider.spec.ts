import {
  applyComfyFilenamePrefix,
  applyComfyPrompts,
  describeComfyWorkflowIncompatibility,
  extractComfyImageRef,
  findPromptFieldsInApiPrompt,
  isComfyApiFormat,
  normalizeComfyUiBaseUrl,
  randomizeComfySeeds,
  resolveComfyWorkflowPath,
  safeComfyWorkflowFilename,
  toCompatibleComfyWorkflow,
} from './comfyui.provider';

describe('ComfyUiProvider workflow helpers', () => {
  const apiPrompt = {
    '164:161': {
      class_type: 'StringConcatenate',
      inputs: {
        string_a: 'Mangamast3r, score_9',
        string_b: ['179:177', 0],
        delimiter: ',',
      },
      _meta: { title: 'Positive Prompt' },
    },
    '164:162': {
      class_type: 'StringConcatenate',
      inputs: {
        string_a: 'worst quality',
        string_b: '',
        delimiter: '',
      },
      _meta: { title: 'Negative Prompt' },
    },
    '164:170': {
      class_type: 'SaveImage',
      inputs: {
        images: ['164:106', 0],
        filename_prefix: 'test',
      },
      _meta: { title: 'Save Image' },
    },
    '165': {
      class_type: 'SeedNode',
      inputs: { seed: 42 },
      _meta: { title: 'Seed' },
    },
  };

  it('normalizes trailing slashes on the base URL', () => {
    expect(normalizeComfyUiBaseUrl('http://127.0.0.1:8188/')).toBe('http://127.0.0.1:8188');
  });

  it('sanitizes workflow filenames for project storage', () => {
    expect(safeComfyWorkflowFilename('/tmp/My Workflow!.json')).toBe('My_Workflow_.json');
    expect(safeComfyWorkflowFilename('/tmp/plain')).toBe('plain.json');
  });

  it('rejects path traversal in workflow ids', () => {
    expect(() => resolveComfyWorkflowPath('/proj/comfyui-workflows', '../secret.json')).toThrow();
    expect(() => resolveComfyWorkflowPath('/proj/comfyui-workflows', 'sub/a.json')).toThrow();
    expect(resolveComfyWorkflowPath('/proj/comfyui-workflows', 'ok.json')).toBe(
      '/proj/comfyui-workflows/ok.json'
    );
  });

  it('describes why UI-format workflows cannot be imported', () => {
    const uiWorkflow = {
      nodes: [],
      links: [],
    };
    expect(describeComfyWorkflowIncompatibility(uiWorkflow)).toContain('Export (API)');
  });

  it('describes missing prompt titles on API workflows', () => {
    expect(
      describeComfyWorkflowIncompatibility({
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'hi' }, _meta: { title: 'Prompt' } },
      })
    ).toContain('Positive Prompt');
  });

  it('randomizes numeric seeds', () => {
    const prompt = structuredClone(apiPrompt);
    randomizeComfySeeds(prompt);
    expect(prompt['165'].inputs.seed).not.toBe(42);
  });

  it('applies prompts into StringConcatenate string_b', () => {
    const prompt = structuredClone(apiPrompt);
    const fields = findPromptFieldsInApiPrompt(prompt)!;
    applyComfyPrompts(prompt, fields.positive, fields.negative, {
      positivePrompt: 'hero face',
      negativePrompt: 'blurry',
    });
    expect(prompt['164:161'].inputs.string_b).toBe('hero face');
    expect(prompt['164:162'].inputs.string_b).toBe('blurry');
  });

  it('rewrites SaveImage filename_prefix from the character name', () => {
    const prompt = structuredClone(apiPrompt);
    applyComfyFilenamePrefix(prompt, 'Dessir Galsea');
    expect(prompt['164:170'].inputs.filename_prefix).toBe('dessir-galsea');
  });

  it('prefers output images over temp previews', () => {
    expect(
      extractComfyImageRef({
        '164:170': {
          images: [{ filename: 'dessir_00001_.png', type: 'output' }],
        },
        '175': {
          images: [{ filename: 'ComfyUI_temp.png', type: 'temp' }],
        },
      })
    ).toEqual({ filename: 'dessir_00001_.png', type: 'output' });
  });

  it('ignores UI-format workflows when listing', () => {
    const uiWorkflow = {
      nodes: [{ id: 1, type: 'CheckpointLoaderSimple', title: null }],
      links: [],
      definitions: {
        subgraphs: [
          {
            id: 'sg',
            nodes: [
              {
                id: 161,
                type: 'StringConcatenate',
                title: 'Positive Prompt',
                widgets_values: ['template,', 'character', ','],
              },
              {
                id: 162,
                type: 'StringConcatenate',
                title: 'Negative Prompt',
                widgets_values: ['bad,', '', ''],
              },
            ],
          },
        ],
      },
    };
    expect(toCompatibleComfyWorkflow('mangamaster_v3.json', uiWorkflow)).toBeNull();
    expect(isComfyApiFormat(uiWorkflow)).toBeFalse();
  });

  it('accepts API-format workflows with titled prompt nodes', () => {
    const compatible = toCompatibleComfyWorkflow('mangamaster_v3.api.json', apiPrompt);
    expect(compatible?.name).toBe('mangamaster_v3.api');
    expect(compatible?.positivePromptTemplate).toBe('Mangamast3r, score_9');
    expect(compatible?.negativePromptTemplate).toBe('worst quality');
  });
});
