export interface PlotThread {
  id: string;
  name: string;
  characters: string[];
}

export interface PlotBoardFrontmatter {
  threads: PlotThread[];
}

export interface PlotBoard {
  threads: PlotThread[];
  rows: string[];
  cells: Record<string, Record<string, string>>;
}
