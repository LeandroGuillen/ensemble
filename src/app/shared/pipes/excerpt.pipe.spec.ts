import { ExcerptPipe, WikiTextPipe } from './excerpt.pipe';

describe('ExcerptPipe / WikiTextPipe wiki link display', () => {
  const body = 'Met [[Unit #7]] at the docks; not \\[[Literal]].';

  it('character card and list previews keep # names and escaped links', () => {
    expect(new ExcerptPipe().transform(body, 150)).toBe('Met Unit #7 at the docks; not \\[[Literal]].');
  });

  it('plot-board beats keep # names and escaped links', () => {
    expect(new WikiTextPipe().transform(body)).toBe('Met Unit #7 at the docks; not \\[[Literal]].');
  });
});
