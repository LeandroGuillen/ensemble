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
[demo project](../examples/demo-project/) (The Lantern Coast). Opened from a git
checkout, it opens as a writable copy in Ensemble's user data folder, so the
checkout stays unchanged.

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

**Duplicate** makes a near-copy — a sibling, a variant, a template. Use the
Duplicate button on a character's page, the copy icon on a card in the grid or
list view, or *Duplicate character…* in the command palette. The copy is named
*Name (copy)*, then *(copy 2)*…, gets its own id, and opens with the name ready
to edit. It keeps the description, category, tags, aliases, books (with their
per-book pages and overrides) and gets its own copies of every portrait.
House membership, casts, pinboards, plot threads and book PoV are not copied.
A draft is copied into the Drawer and a Lore figure stays Lore.

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

On a book's plan screen, **Link characters** previews links for exact-case,
whole-word character names and aliases in that plan. Confirm to add them as one
undoable edit; Ctrl/Cmd+Z in the editor restores the original text. Shared names,
shortened names, common English/Spanish words, and names shared with locations or
Houses stay unchanged in a separate review report. Each report entry shows its
chapter, line, text and candidate characters; click its line to jump there.
Headings, PoV/date lines, code, existing links and hidden/marker content are
preserved. The report clears when the plan changes; scan again to refresh it.

## Houses

**Houses** are families and dynasties: a crest, motto, colors, a seat (a
location), an ordered list of reigns with joint heads, and a Markdown history.
Characters belong to one or more Houses across your world's history.

## World map

The **World map** (sidebar, under Locations) answers "what is near what?". Drag
places from the *Not on the map* list onto the canvas, or use **Pin all
unplaced** for a rough layout to rearrange. Drag pins to move them, drag the
background to pan, and scroll to zoom. Clicking a pin opens the location.
**Draw roads** connects pins: click one, then another; clicking a connected
pair again removes the road. Click a road to give it a label such as "Coast
road, 3 days". Enter, Tab, clicking the background (including starting a pan),
or selecting another road saves the label. Escape also saves the label and closes
the Road panel, even while typing. Removing a road saves its label first, so
Undo restores the road with that label. Every change is saved to `world-map.md`
right away, and Ctrl+Z and Ctrl+Shift+Z undo and redo. Focused pins move with the arrow keys (Shift for
bigger steps); Delete takes them off the map. In a read-only project you can look
around and open places, but not change the map.

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

## Timeline

The **Timeline** page (sidebar → Timeline) shows your world's history in two views,
both using the project's own calendar (Settings → Timeline: month names and lengths,
a name and a year suffix such as *CR*). Dates are written `322`, `322-03` (a month),
`322-03-09` (a day) or `c. 322` (approximate); ranges use `→`.

- **Chronicle**: one stream of dated entries grouped by era. You write events in
  `chronicle.md` (add them with **Add entry** or **Quick add**, for example
  `322-03 The blackout @Vellhaven +Mara`). Births and deaths (a character's
  **Born**/**Died**), House reigns with **From**/**To** dates and the span of each
  book's dated chapters appear automatically as dashed *derived* entries. Select an
  entry to see how old everyone involved was at the time.
- **Lifelines**: one line per character from birth to death, grouped by House and
  coloured by where they lived (the character's **Lived at** list), with House reigns,
  chronicle events joining the people involved, and book bands. Hover to read
  everyone's age; click to pin a year and see who was alive, where, and who ruled.

On a book's page, the **Timeline** tab lays out the chapters by their `When:` dates,
in PoV or place lanes. Switch to **Reading order** to see flashbacks. Continuity
checks flag anyone who is in two places at once (from the chapters' `Lugar:` lines
and linked characters), a PoV who isn't born yet or has died, chapters that step
back in time, and chapters without a date. Edit a chapter's date there and it is
written back to the plan.

## Linking with wikilinks

Type `[[` in any description to link a character, location or House by name
(`[[Mara Vell]]` or `[[Mara Vell|the keeper]]`). Complete the name as you type,
and `Ctrl`/`Cmd` + click to open the target. A link to a name that doesn't exist
yet offers to create the record. The **Mentioned in** panel on each record lists
every place that links to it.

When you save a renamed character, location or House, Ensemble offers to update
inbound wiki links, showing the link count, affected files and a preview. Accepting
keeps custom labels and heading links. Choose **Keep links unchanged** to save the
new name without editing inbound links. **Add old name as alias** keeps the old
name available as a link target; aliases resolve only when no name or path matches
and they identify one record.
Link rewriting leaves code examples, image embeds and frontmatter references untouched.

If a draft has the same name as a published character, `[[Name]]` links to the
published character. Link the draft by its path instead, e.g.
`[[characters/@drafts/mara-vell/mara-vell]]` (the `[[` suggestion does this for you).

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
  to a limit you set. Linked folders (such as a shared character folder) are
  followed, except a link to a folder that contains the project and snapshot
  zips reached through a link (even renamed ones); these are listed as skipped.
- **Undoable deletes**: deleting a character, draft, Lore figure, location,
  House or cast stages it and offers **Undo** for 15 seconds, then moves it to
  your system Trash. Anything in `.ensemble-trash/` is staged for deletion, so
  exclude that folder from your own backups or exports.
- **Deleting a book** removes it from every character (including its per-book
  category, tags and pictures), location and House reign, and moves the
  characters' notes for that book (`<slug>.<code>.md`) to your system Trash,
  so a new book with the same code starts with no notes.
- **Deleting a tag or category** (Settings) first tells you how many characters
  use it. A deleted tag is removed from every character's tags and per-book
  tags; a deleted category is removed from per-book categories (that book then
  uses the character's main category). A character still naming a deleted tag
  or category in a per-book override has it dropped the next time it is saved.
