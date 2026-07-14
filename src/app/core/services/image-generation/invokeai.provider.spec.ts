import {
  buildInvokeGraph,
  extractImageName,
  extractWorkflowPromptTemplates,
  normalizeInvokeAiBaseUrl,
  toCompatibleWorkflow,
} from './invokeai.provider';

describe('InvokeAiProvider workflow conversion', () => {
  const positive = { nodeId: 'positive', fieldName: 'value' };
  const negative = { nodeId: 'negative', fieldName: 'value' };
  const workflow = {
    id: 'mangamaster',
    exposedFields: [positive, negative],
    nodes: [
      invocation('positive', 'string', 'Positive Prompt', { value: 'old positive' }),
      invocation('negative', 'string', 'Negative Prompt', { value: 'old negative' }),
      invocation('model', 'sdxl_model_loader', 'Model', {
        model: { key: 'pony-id', name: 'ponyDiffusionV6XL' },
      }),
      invocation('denoise', 'denoise_latents', 'Denoise', {
        steps: 32,
        cfg_scale: 6,
      }),
      invocation('output', 'l2i', 'Output', {
        board: 'auto',
      }),
    ],
    edges: [
      {
        source: 'positive',
        sourceHandle: 'value',
        target: 'denoise',
        targetHandle: 'prompt',
      },
      {
        source: 'group',
        sourceHandle: null,
        target: 'denoise',
        targetHandle: null,
      },
    ],
  };

  it('detects workflows exposing positive and negative prompts', () => {
    const compatible = toCompatibleWorkflow({
      workflow_id: 'workflow-1',
      name: 'Mangamaster',
      workflow,
    } as any);
    expect(compatible?.name).toBe('Mangamaster');
    expect(compatible?.positivePromptField).toEqual(positive);
    expect(compatible?.negativePromptField).toEqual(negative);
  });

  it('replaces only prompt values and preserves fixed model settings', () => {
    const graph = buildInvokeGraph(
      workflow,
      positive,
      negative,
      'Dessir portrait',
      'jewelry, crown'
    );
    expect(graph.nodes.positive.value).toBe('Dessir portrait');
    expect(graph.nodes.negative.value).toBe('jewelry, crown');
    expect(graph.nodes.model.model).toEqual({
      key: 'pony-id',
      name: 'ponyDiffusionV6XL',
    });
    expect(graph.nodes.denoise.steps).toBe(32);
    expect(graph.nodes.output.board).toBeUndefined();
    expect(graph.edges.length).toBe(1);
  });

  it('converts an explicit saved board id to an InvokeAI BoardField', () => {
    const withBoard = {
      ...workflow,
      nodes: [
        ...workflow.nodes,
        invocation('board-output', 'l2i', 'Output', {
          board: 'portraits-board',
        }),
      ],
    };
    const graph = buildInvokeGraph(withBoard, positive, negative, 'portrait', '');
    expect(graph.nodes['board-output'].board).toEqual({
      board_id: 'portraits-board',
    });
  });

  it('extracts the final image name from nested queue results', () => {
    expect(
      extractImageName({
        first: { image: { image_name: 'preview.png' } },
        output: { type: 'image_output', image: { image_name: 'final.png' } },
      })
    ).toBe('final.png');
  });

  it('normalizes the InvokeAI UI route to the API root', () => {
    expect(normalizeInvokeAiBaseUrl('http://invoke.test/app/')).toBe('http://invoke.test');
  });

  it('reads fixed prompt templates from string join nodes in the workflow', () => {
    const positiveTemplate = 'score_9, score_8_up, score_7_up, score_6_up, XIX century, Mangamast3r,';
    const negativeTemplate = 'score_4, score_5, blurry,';
    const withTemplates = {
      ...workflow,
      nodes: [
        ...workflow.nodes,
        invocation('positive-join', 'string_join', 'Positive Style Concat', {
          string_left: positiveTemplate,
          string_right: '',
        }),
        invocation('negative-join', 'string_join', 'Negative Style Concat', {
          string_left: negativeTemplate,
          string_right: '',
        }),
      ],
      edges: [
        ...workflow.edges,
        {
          source: 'positive',
          sourceHandle: 'value',
          target: 'positive-join',
          targetHandle: 'string_right',
        },
        {
          source: 'negative',
          sourceHandle: 'value',
          target: 'negative-join',
          targetHandle: 'string_right',
        },
      ],
    };

    expect(extractWorkflowPromptTemplates(withTemplates, positive, negative)).toEqual({
      positive: positiveTemplate,
      negative: negativeTemplate,
    });

    const compatible = toCompatibleWorkflow({
      workflow_id: 'workflow-1',
      name: 'Mangamaster',
      workflow: withTemplates,
    } as any);
    expect(compatible?.positivePromptTemplate).toBe(positiveTemplate);
    expect(compatible?.negativePromptTemplate).toBe(negativeTemplate);
  });
});

function invocation(
  id: string,
  type: string,
  label: string,
  values: Record<string, unknown>
): any {
  return {
    id,
    type: 'invocation',
    data: {
      id,
      type,
      label,
      isIntermediate: true,
      useCache: true,
      inputs: Object.fromEntries(
        Object.entries(values).map(([name, value]) => [
          name,
          { name, label: name === 'value' ? label : '', value },
        ])
      ),
    },
  };
}
