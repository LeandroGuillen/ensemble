# Data format

How Ensemble stores Houses, Lore figures, Locations, Prompts and the Timeline on disk. See the [README](../README.md) for the project overview.

## File and folder names

Folder names are derived from an ASCII-only transliteration of the character name
(`José García` becomes `jose-garcia`). If that slug is already in use, Ensemble
appends part of the stable character ID. The former `_name.md` layout is still
readable for compatibility, but newly created characters use this structure.

## Wiki-link aliases

Characters, locations and Houses support an optional `aliases` list in YAML
frontmatter (for example `aliases: [Dess, The Grey Witch]`). Saving a rename can
add the previous name to this list. Names and paths take precedence over aliases.
Aliases are tried only when no name or path matches, and must identify one record
under the usual draft priority rules. Explicit file paths can disambiguate shared names.

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

Reigns may also have `from` and `to` world dates (for example `from: 318`,
`to: 322-03`). They place the reign on the Timeline; they never reorder the list.

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

The Map page contains named maps, each with its own background, pins and roads.
They are stored in `world-map.md` at the project root. Existing single-map files
open as **World map** and retain the original format until you create another map
or rename the first one. The original format is:

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

Creating or renaming a map writes a version 2 collection:

```markdown
---
version: 2
maps:
  - id: world
    name: The Continent
    pins:
      - location: m0k3r5abc123
        name: Grey Harbor
        x: 120
        y: -40
    roads: []
  - id: capital
    name: Capital City
    membership:
      types: [district, building]
      include: []
      exclude: []
    background:
      file: assets/maps/capital.svg
      name: Capital.svg
      x: -500
      y: -300
      width: 1000
      height: 600
      opacity: 1
      visible: true
    pins: []
    roads: []
---

Notes for the first map remain below the frontmatter.
```

Map IDs and names must be unique. Subsequent maps can store `notes` inside their
entry. A location ID may appear on several maps with different coordinates.
The optional `membership` rule includes current and future Locations of the chosen
`types`. Its `include` and `exclude` lists hold individual location IDs; exclusions
take priority. `unspecified` matches Locations without a type. Without a membership
rule, existing pin IDs define the map's membership, preserving older files.

Membership and geographic position are separate. Newly included locations wait in
the map's **to position** list; their positions are saved only after the user clicks
their spot on the map. Changing rules never generates coordinates or rearranges
retained pins. Rule changes are previewed until **Apply changes**. Removing a
placement explicitly excludes that location from automatic membership and removes
only that map's connected roads; its Location file and placements elsewhere remain
intact. Missing location IDs are
retained to support undoing Location deletes. Applying a rule change drops pins,
areas and roads only for locations that the change takes off the map (the preview
names them); a location that was already hidden, for example after its type
changed, keeps its pin and roads so changing the type back restores them.

SVG, PNG, JPEG, WebP and GIF backgrounds are copied unchanged into `assets/maps/`.
Raster uploads are limited to 25 MB and validated using their file signatures and
image decoder; SVGs are limited to 10 MB, must be self-contained, and need a valid
`viewBox` or explicit dimensions. Raster dimensions determine the initial frame,
with aspect ratio preserved. Each map stores its own frame, opacity and visibility. Assets remain available for
Undo when a background is replaced or detached. Zoom limits are relative to fitting
the background into the canvas: 0.8× to 64× that fitted scale. Resizing the canvas
revalidates the camera without changing stored pin coordinates. Panning keeps at
least half the background visible along each axis. When the image is larger than
the viewport, the minimum visible extent is half the viewport instead, allowing
navigation to every part of a zoomed map. Right-click a pin
(or use Shift+F10) for details, centering, repositioning, starting a road, or removing
its placement from this map. Read-only projects allow navigation but disable editing
actions in this menu.

Duplicating a map assigns a new ID and a unique “copy” name and selects the copy.
Pins, roads, notes, background settings and location membership rules are copied
independently; both maps may reference the same immutable background asset. Replacing
a background on either map imports a new asset and does not alter the other map.

Map creation, duplication, renaming, placement, and background changes support
session Undo/Redo. Switching maps is a local
preference and does not write the project. Unsupported versions or invalid map
identities make the file read-only instead of overwriting it.

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
  trailing `#`s on a heading line are otherwise dropped from the name. Spaces or
  tabs at the start or end of a variant name are saved as character references
  (`## &#32;Keeper portrait C#&#32;`), because a heading drops them. A name whose
  own text starts or ends with something like `&#32;` gets one extra `amp;` there
  (`&amp;#32;`), which reading removes again.
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

## Timeline

### Calendar

`ensemble.json → settings.calendar` defines the project's months (no leap years):

```json
"calendar": {
  "name": "Coast Reckoning",
  "suffix": "CR",
  "months": [{ "name": "Firstlight", "days": 30 }, { "name": "Gales", "days": 30 }]
}
```

Without it, a 12-month January–December calendar is used. World dates are written
`322`, `322-03`, `322-03-09` or `c. 322` (approximate); years may be negative.
Ranges join two dates with `→` (or `->`, `..`).

### Chronicle

The chronicle is a Markdown file at the project root, `chronicle.md` by default
(`settings.chronicleFile` changes it). `#` headings are eras; text below an era
heading is its description, and an optional `From:` line sets its start (otherwise
its earliest entry). `##` headings are entries: `<date> · <title>` (` - ` also works);
`? · <title>`, or a heading without a date, is an undated entry. Optional property
lines directly below an entry heading:

```markdown
## 322-03 · The blackout
Where: [[Vellhaven Lighthouse]]
With: [[Mara Vell]], [[Saffi Reed]]
Book: lc1
Kind: legend

Free Markdown text.
```

When saving notes, Ensemble escapes body headings (`\## Aftermath`) and property
keywords (`With\: a memory`) outside code fences. These reopen as the original
Markdown notes, rather than new entries, eras or properties. Existing backslashes
in those positions are escaped once more so repeated saves preserve them. Titles
use Markdown escapes for hashes and backslashes (for example, `Learning C\#`).
Hand-written, unescaped headings and properties retain their structural meaning;
Markdown closing hashes separated by whitespace are still accepted in headings.

`Kind: legend` marks uncertain or mythical entries. Ensemble edits only the lines of
the entry being changed, in date order within its era; it refuses to save when the
file changed on disk since it was read.

### Characters

Character frontmatter may have `born` and `died` world dates and a `residence` list
(where the character lives from a date on, until the next row; `place` is a location
ID and `note` marks a missing or away stretch):

```yaml
born: 312
residence:
  - from: 312
    place: port-saltmere
  - from: 322-05
    place: the-undertide
    note: taken by the sea
```

### Book plans

A chapter's story-time date is a `When:` line directly below its heading, next to
`PoV:` lines (in any order): `When: 330-03-09` or `When: 330-03-09 → 330-03-12`.
A chapter's place comes from its first `Lugar:` line (a location wikilink or plain
text). Chapter codes are 2 to 5 digits (`## 01 - Title`, `## 2180 - Title`).

