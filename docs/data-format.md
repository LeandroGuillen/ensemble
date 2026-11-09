# Data format

How Ensemble stores Houses, Lore figures, Locations and Prompts on disk. See the [README](../README.md) for the project overview.

## File and folder names

Folder names are derived from an ASCII-only transliteration of the character name
(`José García` becomes `jose-garcia`). If that slug is already in use, Ensemble
appends part of the stable character ID. The former `_name.md` layout is still
readable for compatibility, but newly created characters use this structure.

## Houses

Houses are stored under `houses/`, one folder per House. The main Markdown file
has `type: house` in its YAML frontmatter. Crests use the same project image
references as character thumbnails. Membership is stored in the House's
`characterIds`; characters may belong to multiple Houses, regardless of book.
Membership selections in the character editor are committed with Save Changes.

The `leadership` array is chronological, oldest to newest: its saved array order
is authoritative. Each entry has a stable `id`, `characterIds` (one or more
joint heads), optional `period` and `notes`, and `books` containing optional book
IDs. Dates and book references do not sort entries. Repeated characters across
entries represent interrupted reigns. `currentLeadershipId` explicitly marks
the current reign; an omitted value means unspecified or no current head.
External Markdown edits refresh Houses. Open editors with unsaved changes require
a reload before saving a changed file. Deleting a House preserves characters
and other files in its folder.

## Lore figures

Lore uses the same character files and editor as Characters. Set `lore: true` in
a record's frontmatter to place it in the Lore collection. Only the name is
required; images, category, tags, books, descriptions, and other details are
optional. The editor's Collection switch moves records between Characters and
Lore while preserving their IDs, files, and references.

Lore figures can be House members, historical leaders, cast members, and other
character references. Character pickers show them with a **Lore** label.
Drawer drafts remain separate and are excluded from those pickers.

Drawer drafts can be converted from their editor using **Convert to Character**
or **Convert to Lore**. Characters require a name and category; Lore figures
require only a name. Conversion saves current edits and book notes, preserves
the record's ID and images, and moves its folder out of `@drafts/`.

## Locations

Locations have an optional Type: Country, Region, Settlement, District, Building,
Natural Feature, Continent, Plane, or Other. The editor includes explanations and
examples for each type. Types are stored in Markdown frontmatter as `type` (for
example, `type: settlement` or `type: natural-feature`). Existing locations without
a type remain Unspecified.

The Locations page displays type badges in grid and list views. Search matches
names, descriptions, book names, and type labels. Type, book, and picture filters
can be combined; their selections are remembered, and Clear Filters resets them.
The toolbar wraps below the page title as space becomes limited.

## World map

The World map page places locations as pins on a blank canvas. It is stored in
`world-map.md` at the project root, created the first time you pin something:

```markdown
---
pins:
  - location: m0k3r5abc123   # location id
    name: Grey Harbor        # for reading only; rewritten on save
    x: 120
    'y': -40
roads:
  - from: m0k3r5abc123
    to: m0k3r5def456
    label: Coast road        # optional
---

(optional notes, kept as they are)
```

Coordinates are canvas units with no projection. Pins point at locations by
their stable `id`, so renaming or moving a location file keeps its pin. A pin
whose location no longer exists stays in the file but is not drawn, so a deleted
location that is restored with Undo returns to the same spot. Roads join two
pins; one pair has at most one road, in either direction. The `'y'` quotes come
from the YAML writer; `y:` without quotes reads the same. If the file cannot be
parsed, the map opens read-only and leaves the file untouched.

## Prompts

Prompt files are any `*.md` under the prompts folder (`settings.promptsFolder`,
default `prompts`), scanned recursively. The file name is the prompt's name and
subfolders are free-form organization. Links live in the prompt file only; a
character's prompts are the files whose `characters` list holds its ID.

````markdown
---
characters: [m0k3r5abc123]   # stable character IDs (optional)
locations: [m0k3r5loc001]    # stable location IDs (optional)
tags: [pony, portrait]       # free-form (optional)
created: "2026-11-05T10:00:00Z"
modified: "2026-11-05T10:00:00Z"
---
Notes in plain Markdown.

```prompt
1woman, solo, score_9, (long blonde braids)+, {sad|happy}
```
```negative
child
```
![[img/gen/dessir-1.png]]

## with clothes
```prompt
1woman, solo, white buttoned shirt
```
````

- Text before the first `##` is the main section; each `##` heading starts a named variant.
- Within a section, the first ` ```prompt ` and ` ```negative ` blocks are the prompt and
  negative prompt. Fenced blocks keep prompt syntax exactly as written.
- Lines made only of `![[path]]` embeds attach images (project-relative paths) to that
  section. Images picked from outside the project are copied to `prompts/_images/`.
- Anything else (other code blocks, `###` headings, prose) is kept as the section's notes.
  When Ensemble saves a section it writes notes first, then the blocks, then the images.
- Notes are saved exactly as typed, except for lines that would read back differently.
  Those get one leading backslash, removed again when the file is read: a line that
  would start a variant (`\## Golden hour`), an image-only line (`\![[img/a.png]]`),
  a fence opening line whose block would not stay in the notes (a ` ```prompt ` or
  ` ```negative ` block, or a fence that is not closed within the notes: `` \``` ``), and
  a blank line at the start or end of the notes (written as a lone `\`). A line that
  already starts with backslashes before one of these gets one more. A variant
  name ending in `#` is saved with a closing ` #` (`## Keeper portrait C# #`), because
  trailing `#`s on a heading line are otherwise dropped from the name.
- A variant heading starts at the beginning of the line. An indented `##` line
  (space or tab) is notes, also when it is the first line of the file body.
- Unknown frontmatter keys are preserved.
- Deleting a character, draft or location removes its ID from every prompt file
  that links it (Undo puts it back). If a link may survive (a prompt file that
  can't be read, or a failed update that couldn't be rolled back), the deleted
  record's name is first saved in `ensemble.json` under
  `deletedRecordNames.characters` / `deletedRecordNames.locations` (ID → name),
  and the link shows it as "Name (deleted)" instead of "Missing character".
  If that name can't be saved, the delete is cancelled. Names no readable prompt
  links any more are dropped the next time one is saved.

