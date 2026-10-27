/** Scroll distance (px) to push past an edge before moving to the next / previous section. */
export const OVERSCROLL_THRESHOLD = 400;
/** How fast built-up overscroll drains when the user stops pushing (px per ms). */
export const OVERSCROLL_DECAY = 0.25;
/** Deltas are ignored this long after reaching an edge, so a fling's momentum doesn't count. */
export const OVERSCROLL_EDGE_GRACE_MS = 200;

export type OverscrollDirection = 1 | -1;

export interface OverscrollState {
  /** 1 = pushing down past the bottom, -1 = pushing up past the top, 0 = idle. */
  direction: OverscrollDirection | 0;
  /** 0..1 */
  progress: number;
  /** True once, when the threshold is reached. */
  fired: boolean;
}

/**
 * Turns wheel deltas at a scroll edge into "keep pushing to continue" progress.
 * Progress drains over time, so only deliberate, sustained scrolling reaches the threshold.
 */
export class OverscrollTracker {
  private amount = 0;
  private direction: OverscrollDirection | 0 = 0;
  private lastTime = 0;
  private edgeSince: number | null = null;
  private edgeDirection: OverscrollDirection | 0 = 0;

  /**
   * @param delta wheel deltaY in px (positive = down)
   * @param edge which edge the scroller is at in the delta's direction (0 = not at that edge)
   */
  feed(delta: number, edge: OverscrollDirection | 0, now: number): OverscrollState {
    this.drain(now);
    const direction: OverscrollDirection = delta > 0 ? 1 : -1;

    if (edge !== direction) {
      this.edgeSince = null;
      this.edgeDirection = 0;
      this.reset();
      return this.state(false);
    }
    if (this.edgeDirection !== edge) {
      this.edgeDirection = edge;
      this.edgeSince = now;
    }
    if (this.direction !== direction) {
      this.reset();
      this.direction = direction;
    }
    if (this.edgeSince !== null && now - this.edgeSince < OVERSCROLL_EDGE_GRACE_MS) {
      return this.state(false);
    }

    this.amount += Math.abs(delta);
    if (this.amount >= OVERSCROLL_THRESHOLD) {
      const fired = this.state(true);
      this.reset();
      this.edgeSince = now;
      return fired;
    }
    return this.state(false);
  }

  /** Re-evaluate draining without new input (for animating the indicator back to zero). */
  tick(now: number): OverscrollState {
    this.drain(now);
    return this.state(false);
  }

  reset(): void {
    this.amount = 0;
    this.direction = 0;
  }

  private drain(now: number): void {
    if (this.lastTime) this.amount = Math.max(0, this.amount - (now - this.lastTime) * OVERSCROLL_DECAY);
    this.lastTime = now;
    if (this.amount === 0) this.direction = 0;
  }

  private state(fired: boolean): OverscrollState {
    return {
      direction: fired || this.amount > 0 ? this.direction : 0,
      progress: fired ? 1 : Math.min(1, this.amount / OVERSCROLL_THRESHOLD),
      fired,
    };
  }
}
