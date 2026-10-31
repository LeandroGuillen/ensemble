# Data format

How Ensemble stores Houses, Lore figures and Locations on disk. See the [README](../README.md) for the project overview.

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
