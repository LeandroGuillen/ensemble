import {
  OVERSCROLL_DECAY,
  OVERSCROLL_EDGE_GRACE_MS,
  OVERSCROLL_THRESHOLD,
  OverscrollTracker,
} from './overscroll';

describe('OverscrollTracker', () => {
  const start = 1000;
  let tracker: OverscrollTracker;

  beforeEach(() => (tracker = new OverscrollTracker()));

  /** Reach the bottom edge and wait out the grace period. */
  const arrive = (): number => {
    tracker.feed(10, 1, start);
    return start + OVERSCROLL_EDGE_GRACE_MS;
  };

  it('ignores scrolling away from an edge', () => {
    expect(tracker.feed(100, 0, start)).toEqual({ direction: 0, progress: 0, fired: false });
  });

  it('ignores deltas right after reaching the edge (momentum)', () => {
    tracker.feed(100, 1, start);
    expect(tracker.feed(100, 1, start + 50).progress).toBe(0);
  });

  it('builds progress and fires once at the threshold', () => {
    let now = arrive();
    const half = tracker.feed(OVERSCROLL_THRESHOLD / 2, 1, now);
    expect(half.direction).toBe(1);
    expect(half.progress).toBeCloseTo(0.5);
    expect(half.fired).toBeFalse();

    now += 1;
    const done = tracker.feed(OVERSCROLL_THRESHOLD / 2 + 1, 1, now);
    expect(done.fired).toBeTrue();
    expect(tracker.feed(50, 1, now + 1).progress).toBe(0);
  });

  it('drains when the user stops pushing', () => {
    const now = arrive();
    tracker.feed(200, 1, now);
    const later = tracker.tick(now + 100);
    expect(later.progress).toBeCloseTo((200 - 100 * OVERSCROLL_DECAY) / OVERSCROLL_THRESHOLD);
    expect(tracker.tick(now + 10_000)).toEqual({ direction: 0, progress: 0, fired: false });
  });

  it('works upwards at the top edge and resets when the direction flips', () => {
    tracker.feed(-10, -1, start);
    const now = start + OVERSCROLL_EDGE_GRACE_MS;
    expect(tracker.feed(-200, -1, now).direction).toBe(-1);
    expect(tracker.feed(50, 0, now + 1).progress).toBe(0);
  });
});
