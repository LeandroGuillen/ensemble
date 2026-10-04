import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Cast, Pinboard, PinboardViewState } from '../interfaces/project.interface';
import { PinboardData } from '../interfaces/pinboard.interface';
import { reconcileCastPinboard } from '../utils/cast-pinboard.utils';

/** One pending edit shared by the member form and relationship canvas. */
@Injectable({ providedIn: 'root' })
export class CastEditorSessionService {
  private state = new BehaviorSubject<{ cast: Cast; board: Pinboard } | null>(null);
  readonly changes$ = this.state.asObservable();
  get cast(): Cast | null { return this.state.value?.cast || null; }
  get board(): Pinboard | null { return this.state.value?.board || null; }

  begin(cast: Cast, board: Pinboard): void {
    this.state.next({ cast: structuredClone(cast), board: structuredClone(board) });
  }

  updateCast(updates: Partial<Cast>): void {
    const state = this.state.value;
    if (!state) return;
    const cast = { ...state.cast, ...structuredClone(updates) };
    this.state.next({ cast, board: reconcileCastPinboard(cast, state.board) });
  }

  updateData(data: PinboardData): void {
    const state = this.state.value;
    if (state) this.state.next({ ...state, board: { ...state.board, ...structuredClone(data) } });
  }

  updateViewState(viewState: PinboardViewState): void {
    const state = this.state.value;
    if (state) this.state.next({ ...state, board: { ...state.board, viewState: structuredClone(viewState) } });
  }

  end(): void { this.state.next(null); }
}
