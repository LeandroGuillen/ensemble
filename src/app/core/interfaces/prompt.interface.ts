/**
 * Prompt files live under the project's prompts folder (default `prompts/`),
 * one Markdown file per prompt subject, organized in any subfolders.
 *
 * ````markdown
 * ---
 * characters: [m0k3r5abc123]
 * locations: []
 * tags: [pony]
 * ---
 * Notes about this prompt (plain Markdown).
 *
 * ```prompt
 * 1woman, solo, 2 long braids…
 * ```
 * ```negative
 * child
 * ```
 * ![[img/dessir/result-1.png]]
 *
 * ## with clothes
 * ```prompt
 * …
 * ```
 * ````
 *
 * The text before the first `##` heading is the unnamed main section; every
 * `##` heading starts a named variant. Fenced blocks keep prompt syntax such as
 * `score_9`, `(braids)+` or `{sad|happy}` verbatim.
 */
export interface PromptSection {
  /** `##` heading text; empty for the main section before the first heading. */
  name: string;
  /** Free Markdown that is not a prompt block or an image embed. */
  notes: string;
  /** Content of the first ```prompt block; null when the section has none. */
  prompt: string | null;
  /** Content of the first ```negative block; null when the section has none. */
  negative: string | null;
  /** Project-relative image paths from `![[…]]` embeds, in file order. */
  images: string[];
}

export interface PromptFileData {
  /** Linked character IDs. Prompts own the link; characters derive it. */
  characters: string[];
  /** Linked location IDs. */
  locations: string[];
  /** Free-form tags (tool, style…), independent of character tags. */
  tags: string[];
  created?: string;
  modified?: string;
  /** Frontmatter keys Ensemble does not manage, written back unchanged. */
  extra: Record<string, unknown>;
  /** `sections[0]` is always the main (unnamed) section. */
  sections: PromptSection[];
}

export interface PromptFile extends PromptFileData {
  /** Path relative to the prompts folder, with `/` separators (e.g. `characters/dessir.md`). */
  relativePath: string;
  filePath: string;
  /** File name without `.md`; this is the prompt's display name. */
  name: string;
  /** Folder relative to the prompts folder; empty for the root. */
  folder: string;
}
