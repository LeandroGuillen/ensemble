import { StoryTimeComponent } from './story-time.component';
import { TimelineContext } from '../../../core/services/timeline.service';
import { StoryChapter } from '../../../core/utils/timeline.utils';
import { DEFAULT_CALENDAR } from '../../../core/utils/world-date.utils';

function chapter(key: string, start: number, end = start, pov = 'a'): StoryChapter {
  return { key, bookId: 'book', code: key, title: key, line: 0, order: 0,
    whenText: '', date: null, invalid: false, range: { start, end },
    pov: [pov], place: null, placeLabel: null, people: [pov] };
}

function layout(chapters: StoryChapter[]): StoryTimeComponent {
  const component = Object.create(StoryTimeComponent.prototype) as StoryTimeComponent;
  Object.assign(component, {
    ctx: { calendar: DEFAULT_CALENDAR, charactersById: new Map() } satisfies Partial<TimelineContext>,
    chapters, issues: [], mode: 'story', laneBy: 'pov', zoom: 60,
  });
  spyOn<any>(component, 'schedulePath').and.stub();
  component.layout();
  return component;
}

describe('Story time overlapping chapters', () => {
  it('stacks same-day chapters and moves the next PoV lane below them', () => {
    const component = layout([chapter('1', 100), chapter('2', 100), chapter('3', 101), chapter('4', 100, 100, 'b')]);
    const [a, b, nextDay, otherPov] = component.blocks;
    expect(a.x).toBe(b.x);
    expect(b.y - a.y).toBe(50);
    expect(a.w).toBe(58);
    expect(b.w).toBe(58);
    expect(nextDay.y).toBe(a.y);
    expect(otherPov.y).toBeGreaterThan(b.y + 38);
    expect(component.lanes[0].height).toBe(100);
    expect(component.height).toBeGreaterThan(otherPov.y + 38);
  });

  it('keeps the full duration of overlapping ranges', () => {
    const component = layout([chapter('1', 100, 103), chapter('2', 102, 104)]);
    const [a, b] = component.blocks;
    expect(a.w).toBe(238);
    expect(b.w).toBe(178);
    expect(a.y).not.toBe(b.y);
  });
});
