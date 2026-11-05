import { contentSummary } from './content-summary.utils';

describe('contentSummary', () => {
  it('shows wiki labels and Markdown link text without exposing markup', () => {
    expect(contentSummary('## **Mara**\nKnows [[person-id|Ilse]] and [[House Vell]]. [Harbor](place.md)'))
      .toBe('Mara Knows Ilse and House Vell. Harbor');
  });
  it('flattens whitespace and truncates after removing markup', () => {
    expect(contentSummary('**Hello**\n\nworld', 8)).toBe('Hello wo…');
    expect(contentSummary('')).toBe('');
  });
});
