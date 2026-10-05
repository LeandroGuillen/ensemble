/** Array position is the authoritative succession order, independent of books/dates. */
export interface HouseLeadership {
  id: string;
  characterIds: string[];
  period: string;
  books: string[];
  notes: string;
}

export interface HouseFormData {
  name: string;
  motto: string;
  colors: string[];
  thumbnail?: string;
  seatId?: string;
  characterIds: string[];
  leadership: HouseLeadership[];
  /** Explicit current reign; omitted for extinct houses or incomplete histories. */
  currentLeadershipId?: string;
  content: string;
}

export interface House extends HouseFormData {
  id: string;
  created: Date;
  modified: Date;
  filePath: string;
  relativePath: string;
  /** Disk revision used to protect open editors from external changes. */
  raw: string;
}
