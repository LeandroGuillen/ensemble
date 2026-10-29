import { HouseLeadership } from './house.interface';
import { Pinboard, PinboardConnection, PinboardPin } from './project.interface';

/** One reference that could not be restored because its target no longer exists. */
export interface ReferenceRestoreSkip {
  kind: string;
  id: string;
  label: string;
}

export interface ReferenceRestoreResult {
  restored: number;
  skipped: ReferenceRestoreSkip[];
}

/** Book PoV: character id removed from a book at a specific index. */
export interface BookPovRemoval {
  bookId: string;
  bookName: string;
  index: number;
}

export interface BookPovSnapshot {
  characterId: string;
  removals: BookPovRemoval[];
}

/** Cast membership: character removed from a cast's characterIds at index. */
export interface CastMembershipRemoval {
  castId: string;
  castName: string;
  index: number;
}

export interface CastMembershipSnapshot {
  characterId: string;
  removals: CastMembershipRemoval[];
}

/** House membership / leadership / pruned reigns prior to character removal. */
export interface HouseCharacterRemoval {
  houseId: string;
  houseName: string;
  characterIds: string[];
  leadership: HouseLeadership[];
  currentLeadershipId?: string;
  /** Reigns that were dropped because they became empty after removal. */
  prunedReigns: HouseLeadership[];
}

export interface HouseCharacterSnapshot {
  characterId: string;
  removals: HouseCharacterRemoval[];
}

/** Pinboard nodes/edges removed for a character. */
export interface PinboardCharacterRemoval {
  pinboardId: string;
  pinboardName: string;
  nodes: PinboardPin[];
  edges: PinboardConnection[];
  /** Original indexes of removed nodes (parallel to `nodes`). */
  nodeIndexes: number[];
  /** Original indexes of removed edges (parallel to `edges`). */
  edgeIndexes: number[];
}

export interface PinboardCharacterSnapshot {
  characterId: string;
  removals: PinboardCharacterRemoval[];
}

/** Plot-thread character membership removed at a position. */
export interface PlotThreadCharacterRemoval {
  boardPath: string;
  threadId: string;
  threadName: string;
  index: number;
}

export interface PlotThreadCharacterSnapshot {
  characterId: string;
  removals: PlotThreadCharacterRemoval[];
}

/** House seatId cleared when a location is deleted. */
export interface HouseSeatRemoval {
  houseId: string;
  houseName: string;
  seatId: string;
}

export interface LocationReferenceSnapshot {
  locationId: string;
  seats: HouseSeatRemoval[];
}

/** Combined character reference cleanup snapshot. */
export interface CharacterReferenceSnapshot {
  characterId: string;
  bookPovs: BookPovSnapshot;
  casts: CastMembershipSnapshot;
  houses: HouseCharacterSnapshot;
  pinboards: PinboardCharacterSnapshot;
  plotThreads: PlotThreadCharacterSnapshot;
}

/**
 * Snapshot of a cast delete (casts.json entry + linked pinboard), for Part 3 restore.
 * Not used by any delete flow in Part 2.
 */
export interface CastDeleteSnapshot {
  castEntry: {
    id: string;
    name: string;
    characterIds: string[];
    pinboardId?: string;
  };
  folderPath?: string;
  pinboard?: Pinboard;
}
