export interface PlotThread {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  characters: string[];
}

export interface PlotRow {
  name: string;
  icon?: string;
}

export interface PlotCellMeta {
  icon?: string;
  color?: string;
}

export interface PlotBoardFrontmatter {
  threads: PlotThread[];
  rows?: PlotRow[];
  cellMeta?: Record<string, Record<string, PlotCellMeta>>;
}

export interface PlotBoard {
  threads: PlotThread[];
  rows: PlotRow[];
  cells: Record<string, Record<string, string>>;
  cellMeta: Record<string, Record<string, PlotCellMeta>>;
}
