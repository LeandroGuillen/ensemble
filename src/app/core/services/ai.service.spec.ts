import { parseStructuredJson } from './ai.service';

describe('parseStructuredJson', () => {
  it('parses a plain JSON object', () => {
    expect(parseStructuredJson<{ name: string }>('{"name": "Dessir"}')).toEqual({
      name: 'Dessir',
    });
  });

  it('strips markdown fences around the payload', () => {
    const text = '```json\n{"name": "Dessir"}\n```';
    expect(parseStructuredJson<{ name: string }>(text)).toEqual({ name: 'Dessir' });
  });

  it('extracts JSON surrounded by model prose', () => {
    const text = 'Sure! Here is the result:\n{"name": "Dessir"}\nHope that helps.';
    expect(parseStructuredJson<{ name: string }>(text)).toEqual({ name: 'Dessir' });
  });

  it('parses arrays', () => {
    const text = 'Result: [{"name": "A"}, {"name": "B"}]';
    expect(parseStructuredJson<Array<{ name: string }>>(text)).toEqual([
      { name: 'A' },
      { name: 'B' },
    ]);
  });

  it('throws the retry message on unparseable output', () => {
    expect(() => parseStructuredJson('not json at all')).toThrowError(
      'AI choked answering. Please try again.'
    );
  });

  it('throws on truncated JSON', () => {
    expect(() => parseStructuredJson('{"name": "Dess')).toThrowError(
      'AI choked answering. Please try again.'
    );
  });
});
