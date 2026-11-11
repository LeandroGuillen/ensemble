# The Lantern Coast

An original maritime fantasy demo for Ensemble. Along a coast of memory-powered lighthouses, a keeper and a harbor commander must decide which promises to keep when the drowned begin coming home.

## Open it

1. In Ensemble, open this `examples/demo-project` folder as a project (select the folder containing `ensemble.json`).
2. Explore Characters, Lore, Drawer, Houses, Locations, Library, Casts, the relationship pinboards, the plot board and Backstage. Select **Tidebreak** in Library to open its chapter plan. Select a book on Mara, Ilse or Saffi’s page to read the per-book notes.

Ensemble writes project metadata immediately on opening and remembers navigation as you work. So that a git checkout stays unchanged, opening this folder from a checkout opens a writable copy in Ensemble’s user data folder (`demo-projects/demo-project`) instead. A notice shows the copy’s path, and the copy is reopened, with your changes, next time. The `.ensemble-demo` file marks this folder as the demo; the copy does not include it. A copy you make yourself outside a git checkout (for example from the repository ZIP) opens in place. Deletes use an Undo window and then the OS trash; exclude `.ensemble-trash/` from any backup, snapshot or export.

The project starts with the dark Blue Gold theme and Classic skin. There are two casts, each with its own relationship graph: Coast relationships (eight people, with labeled directional connections) and The Lighthouse Crew (four people).

## What to explore

- **The Lantern Keepers** (`lc1`) is published; **Tidebreak** (`lc2`) is in progress. Both belong to The Lantern Coast series. There is no invented ISBN.
- Ten active characters include Wren, who appears only in the second book. Ilse changes from antagonist to supporting character there, with different tags. Mara has a distinct second-book portrait. Alias examples use both supported file formats.
- Two Lore figures remember the founding; one nameless Drawer draft suggests a future bell diver.
- House Vell includes joint leadership and an interrupted reign. Ilse belongs to both houses during her stewardship. House Dunmore deliberately has no designated current leadership entry.
- Six locations cover region, settlement, district, building, natural feature and plane. All have pictures.
- `lantern-coast.pinboard.md` holds three plot threads and six rows. `books/lc2/lc2.plan.md` has six chapters, scenes, viewpoint IDs and TODO markers.
- Mara’s **Keeper portrait** prompt lives in `prompts/characters/Mara Vell.md`, linked by her character ID. Open Prompts or her character page to find it.
- Backstage contains a harbor name list and two concepts.

## Original content and license

All worldbuilding, names, prose and images in this demo are original material created for this example, not taken from anyone’s manuscripts. The 19 illustrations were AI-generated specifically for this demo using the assistant’s built-in image generation capability, then resized and converted to 512 × 512 WebP. They are painted portraits, scenery and heraldic crests, not stock images or initials placeholders.

To the extent copyright or related rights apply, the demo text and images are dedicated to the public domain under **CC0 1.0**. See [the CC0 dedication](https://creativecommons.org/publicdomain/zero/1.0/). No exclusivity or copyright protection is claimed for AI-generated output.

Images live in `img/`: ten character portraits, Mara’s distinct `mara-vell-lc2.webp` portrait, six location pictures and two house crests. The original generation prompts are recorded in `image-prompts.md`.

## Automated verification

From the repository root, run `npm run test:main`, or `node --test test/demo-project.test.js` for just the demo. The test reads this folder without opening or modifying it. It uses the app’s actual wiki-link resolver and checks entity IDs, cross-references, images, current linked prompt storage (with no inline prompts to migrate), required examples and a maintained list of forbidden brand names.
