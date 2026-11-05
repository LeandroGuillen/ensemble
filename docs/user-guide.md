# Ensemble user guide

A short tour of the concepts in Ensemble and how they fit together. For the
exact on-disk file format, see [data-format.md](data-format.md). To build from
source, see [development.md](development.md).

Ensemble keeps everything in one project folder of plain Markdown and JSON files
on your own disk. Nothing is stored on a server, and you can open the same files
in Obsidian or any text editor.

## Projects

A **project** is a folder you open in Ensemble. On first open, Ensemble creates
the folders it needs and a small `ensemble.json` that holds your categories,
tags, books, settings and pinboards. You can keep several projects and switch
between them.

To explore before writing anything, open the bundled
[demo project](../examples/demo-project/) (The Lantern Coast) — copy it somewhere
writable first, because Ensemble writes to a project as soon as it opens it.

## People: Characters, Lore and drafts

- **Characters** are your main cast: full profiles with a category, tags,
  books, portraits and a Markdown description.
- **Lore figures** are background people — founders, ancestors, legends. They
  are name-only records and are labelled *Lore* in pickers, so they never crowd
  out your active cast.
- **Drafts** are unfinished characters in the Drawer. A draft can have empty
  fields and is hidden from the main lists, casts, pinboards and counts. When
  it's ready, promote it to a Character or a Lore figure; the promotion keeps
  everything you wrote.

Every character has a stable **id** stored in its file, so links and references
survive a rename or a move.

**Aliases** (a.k.a. names) attach alternate names to a character so search and
`[[wikilinks]]` can find them.

## Portraits and character styles

A project can define several **character styles** (for example *Default*,
*Realistic*, *Pixel*), each with its own portrait per character. The default
style is used on pinboards and casts. With more than one style, the character
list offers a style switcher; with one, it stays out of your way.

## Books and per-book overrides

Group your work into **books**, each with a cover, a status, a plan file and a
manuscript folder. Characters can appear in several books, and you can override
a character **per book**:

- a **book page** gives the character their own description for that book;
- per-book **category**, **tags** and **portrait** overrides change how they
  look in that book without altering their main profile.

## Houses

**Houses** are families and dynasties: a crest, motto, colors, a seat (a
location), an ordered list of reigns with joint heads, and a Markdown history.
Characters belong to one or more Houses across your world's history.

## Casts and pinboards

A **cast** groups characters together — for example "The Lighthouse Crew" — with
its own description. Each cast has a **pinboard**: a graph where characters are
pins joined by labelled, coloured connections. Pinboards are stored in
`ensemble.json` and are a quick way to map relationships at a glance.

## Prompts

**Prompts** is a repository for image and text prompts. Each prompt is a
Markdown file under the prompts folder (`prompts/` by default, changeable in
Settings → General), organized in any subfolders you like. A file can hold
several **variants** (one per `##` heading), each with a prompt, an optional
negative prompt, notes and the images it produced. Link a prompt to characters
and locations from its editor; the character page lists the prompts linked to
it, and the Characters page's **Prompts** view (also reached from **By
character** on the Prompts page) shows each character's prompts, with the usual
filters and sorting plus a Prompts with/without filter. Search matches the prompt text itself, so "pointy ears" finds every elf.

Prompts that used to live in a character's frontmatter (`prompts:`) are moved
automatically into `prompts/characters/<name>.md`, linked to that character.

## Plot boards

A **plot board** lays your plot out as a grid: threads across the top, rows down
the side, and a cell of notes for each. Move between cells with the keyboard.
Plot boards are Markdown files (`*.pinboard.md`) saved anywhere in your project,
so they travel with your files and diff cleanly in Git.

## Linking with wikilinks

Type `[[` in any description to link a character, location or House by name
(`[[Mara Vell]]` or `[[Mara Vell|the keeper]]`). Complete the name as you type,
and `Ctrl`/`Cmd` + click to open the target. A link to a name that doesn't exist
yet offers to create the record. The **Mentioned in** panel on each record lists
every place that links to it.

## External editing

Because everything is plain files, you can edit in Obsidian or any editor.
Ensemble watches the project folder and refreshes records when files change
outside the app. If you edit a file that Ensemble has unsaved changes for, it
asks whether to keep your version or reload from disk instead of silently
overwriting.

## Backups and deletes

- **Snapshots**: Settings → Backup creates a timestamped zip of the project and
  can restore it into a copy (the live project is never overwritten). Automatic
  snapshots can run before an update migrates your storage; they hold only the
  text files (Markdown, JSON) an update can rewrite, not images, and are kept
  to a limit you set.
- **Undoable deletes**: deleting a character, draft, Lore figure, location,
  House or cast stages it and offers **Undo** for 15 seconds, then moves it to
  your system Trash. Anything in `.ensemble-trash/` is staged for deletion, so
  exclude that folder from your own backups or exports.
