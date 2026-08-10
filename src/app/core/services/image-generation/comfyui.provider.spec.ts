import {
  applyComfyFilenamePrefix,
  applyComfyPrompts,
  extractComfyImageRef,
  findPromptFieldsInApiPrompt,
  isComfyApiFormat,
  normalizeComfyUiBaseUrl,
  randomizeComfySeeds,
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

  it('detects API-format prompts', () => {
    expect(isComfyApiFormat(apiPrompt)).toBe(true);
    expect(
      isComfyApiFormat({
        nodes: [],
        links: [],
      })
    ).toBe(false);
  });

  it('finds positive/negative StringConcatenate fields and templates', () => {
    const fields = findPromptFieldsInApiPrompt(apiPrompt);
    expect(fields?.positive).toEqual({ nodeId: '164:161', fieldName: 'string_b' });
    expect(fields?.negative).toEqual({ nodeId: '164:162', fieldName: 'string_b' });
    expect(fields?.positiveTemplate).toBe('Mangamast3r, score_9');
    expect(fields?.negativeTemplate).toBe('worst quality');
  });

  it('injects prompts into string_b while keeping templates', () => {
    const prompt = structuredClone(apiPrompt);
    const fields = findPromptFieldsInApiPrompt(prompt)!;
    applyComfyPrompts(prompt, fields.positive, fields.negative, {
      positivePrompt: '1woman, blonde',
      negativePrompt: 'jewelry',
    });
    expect(prompt['164:161'].inputs.string_a).toBe('Mangamast3r, score_9');
    expect(prompt['164:161'].inputs.string_b).toBe('1woman, blonde');
    expect(prompt['164:162'].inputs.string_b).toBe('jewelry');
  });

  it('randomizes seed widgets and sets SaveImage prefix from the character name', () => {
    const prompt = structuredClone(apiPrompt);
    randomizeComfySeeds(prompt);
    expect(prompt['165'].inputs.seed).not.toBe(42);
    applyComfyFilenamePrefix(prompt, 'Dessir Galsea');
    expect(prompt['164:170'].inputs.filename_prefix).toBe('dessir-galsea');
  });

  it('extracts the last output image from history outputs', () => {
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
  });

  it('accepts API-format workflows with titled prompt nodes', () => {
    const compatible = toCompatibleComfyWorkflow('mangamaster_v3.api.json', apiPrompt);
    expect(compatible?.name).toBe('mangamaster_v3.api');
    expect(compatible?.positivePromptTemplate).toBe('Mangamast3r, score_9');
    expect(compatible?.negativePromptTemplate).toBe('worst quality');
  });
});
