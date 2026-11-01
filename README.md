# Your characters, in files you own.

Ensemble is a desktop app for writers and worldbuilders to keep their characters, houses, places and plots in plain Markdown files they own.

[![Latest release](https://img.shields.io/github/v/release/leandroguillen/ensemble)](https://github.com/leandroguillen/ensemble/releases/latest)
[![Build and Release](https://github.com/leandroguillen/ensemble/actions/workflows/release.yml/badge.svg)](https://github.com/leandroguillen/ensemble/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/github/license/leandroguillen/ensemble)](https://github.com/leandroguillen/ensemble/blob/master/LICENSE)
[![Platform: Linux](https://img.shields.io/badge/platform-Linux-FCC624?logo=linux&logoColor=black)](https://github.com/leandroguillen/ensemble/releases/latest)

Ensemble keeps your cast, your world and your plot in one folder of Markdown files on your own disk. Open that folder in any editor, back it up with the tools you already use, and keep it in Git if you want. There is no account to create and no server to sign in to.

## Your files stay yours

- No account, no login, no telemetry, no analytics and no crash reporting.
- A project is a folder of plain Markdown files (with YAML front matter), a small `ensemble.json` and your images, on your disk.
- Installed builds check GitHub Releases for new versions when the app starts, every four hours, and when you choose "Check for updates". They never download anything by themselves.
- AI is optional and off by default. Name suggestions use a local model through Ollama or LM Studio. Portraits can use a local server, InvokeAI or ComfyUI. If you choose OpenAI or Gemini for portraits, Ensemble sends the portrait prompt and your API key to that service. Names are never sent to OpenAI or Gemini.
- With local tools, nothing leaves your computer. The update check and a cloud portrait provider are the only exceptions, and the portrait provider is your choice.

## Features

### People

- **Characters**: create, edit and organize character profiles with categories and tags.
- **Aliases**: give a character a.k.a. names and find them from search.
- **Portraits and styles**: keep one portrait per character style and switch the style from the page.
- **List views**: switch between grid, list, compact and gallery with `L`, and resize the gallery with a slider.
- **Character page**: read a text column next to a sticky infobox on a wide screen, stacked on a narrow one.
- **Book pages**: give a character their own description, tags and picture in each book.
- **Lore figures**: keep founders, ancestors and legends as name-only records, labelled Lore in pickers.
- **Drawer**: write a character as a draft and convert it to a Character or a Lore figure later.
- **Casts**: group characters into a cast and pin them on a pinboard with labelled connections.
- **Names**: keep name lists with descriptions, comments and strikethrough for options you dropped.
- **Concepts**: keep titled notes for your ideas in a single `concepts.md` file.

### World

- **Locations**: record places with one of nine types, such as Country, Settlement, Building or Natural Feature.
- **Location filters**: filter by type, book and picture, and clear the filters in one click.
- **Location icons**: give every type its own icon.
- **Houses**: record crests, mottos, colors, seats, members and an ordered list of reigns with joint heads.

### Story

- **Books**: group your work in books, each with a cover, a status, a plan file and a manuscript folder.
- **Book plan**: outline phases, chapters and scenes from chapter headings like `## 2180 - Title`, with a point-of-view portrait, TODO and OJO counts and a focus mode for one chapter.
- **Book plan search**: jump to a year, a character or a marker with `Ctrl+J`.
- **Plan conflicts**: when the plan file changed outside Ensemble, the app offers to keep your version or reload from disk.
- **Plot board**: lay plot threads out in a grid of rows and move between cells with the keyboard.

### Comfort

- **Markdown editor**: write in a CodeMirror editor with live preview, GFM tables and formatting shortcuts.
- **Wikilinks**: link characters, locations and Houses with `[[Name]]`, complete them with `[[`, follow them with `Ctrl`/`Cmd` + click, and open a missing target as a new record.
- **Live external edits**: files changed in Obsidian or another editor refresh in Ensemble, and the character and House editors ask you to reload from disk before saving over a file that changed outside the app.
- **Command palette**: press `Ctrl+P` or `/` to search commands.
- **Shortcut list**: press `Ctrl+?` to see the shortcuts.
- **Themes**: 7 color themes: Blue Gold, Catppuccin Mocha, Grayscale, Gruvbox, Rosé Pine, Sepia and Tokyo Night.
- **Skins**: several skins, including Classic, Pixel and Liquid.
- **Multiple projects**: keep several projects and open a recent one with the keys `1` to `9`.
- **Duplicate project**: copy a project to start a variant of it.
- **Undoable deletes**: delete a character, draft, Lore figure, location, House or cast and undo it for 15 seconds, then it goes to the system trash.
- **Update checks**: installed builds check GitHub Releases and offer to restart into a new version.

## Download and install

Ensemble is Linux first, by design. The releases page has Linux packages. macOS and Windows builds are not published yet.

Get the files for your distribution from [GitHub Releases](https://github.com/leandroguillen/ensemble/releases/latest). Every release ships an AppImage, a Debian package and an RPM. The version number in the file names changes with every release, so read it from the release you download.

**AppImage**, a single file you run:

```bash
chmod +x Ensemble-*.AppImage
./Ensemble-*.AppImage
```

Keep the AppImage in a folder you can write to, so the updater can replace it.

**Debian, Ubuntu and derivatives**:

```bash
sudo dpkg -i ensemble_*_amd64.deb
# or
sudo apt install ./ensemble_*_amd64.deb
```

**Fedora, RHEL and derivatives**:

```bash
sudo rpm -i ensemble-*.x86_64.rpm
# or
sudo dnf install ./ensemble-*.x86_64.rpm
```

## First project

To look around before you write anything, [open the demo project](examples/demo-project/), an invented world called The Lantern Coast. Copy the `examples/demo-project` folder somewhere you can write to first, then open the copy; Ensemble writes to a project as soon as it opens it.

Create a folder on your disk and open it in Ensemble as a project. Ensemble adds the folders it needs and writes a small `ensemble.json` with your categories, tags, books and settings.

```
project-folder/
├── ensemble.json           # Project metadata: categories, tags, books, settings, pinboards
├── .ensemble-trash/        # Staged deletes (exclude from backups/exports); then OS trash
├── characters/             # Configurable character root
│   ├── mara-vell/
│   │   ├── mara-vell.md          # Main file (frontmatter + description)
│   │   └── mara-vell.lc1.md      # Book page, keyed by book code
│   ├── @drafts/                   # Draft character folders
│   │   └── unnamed-a1b2c3/
│   │       └── unnamed-a1b2c3.md
│   ├── casts/                     # Cast folders
│   │   ├── casts.json             # Cast index: names and character ids
│   │   └── the-lighthouse-crew/
│   │       └── description.md
│   ├── concepts.md                # Concepts
│   └── names.md                   # Name lists
├── locations/             # Locations, one file each
│   └── _port-saltmere.md
├── houses/                 # Family and dynasty records
│   └── house-vell/
│       └── house-vell.md    # House frontmatter + Markdown history
├── img/                    # Images, including portraits
└── lantern-coast.pinboard.md  # Plot board
```

Folder names come from an ASCII transliteration of the name. The file layout of Houses, Lore figures and Locations is documented in [docs/data-format.md](docs/data-format.md).

## Development

Ensemble is an Angular 21 and Electron 43 desktop app.

- Node.js 20.19+, 22.12+ or 24+ (the range Angular 21 supports)
- npm or yarn

```bash
npm install
npm start
```

`npm start` runs the Angular dev server and the Electron window. `npm run serve` runs the Angular app in a browser only. See [docs/development.md](docs/development.md) for the dev server port, running a second instance and production builds, and [docs/releasing.md](docs/releasing.md) for how releases are cut.

## Roadmap

Planned work and open problems are tracked in [GitHub Issues](https://github.com/leandroguillen/ensemble/issues). What has shipped is listed in [GitHub Releases](https://github.com/leandroguillen/ensemble/releases).

## Contributing

Report bugs and ask for features on [GitHub Issues](https://github.com/leandroguillen/ensemble/issues). To work on the code, start from the issues list and read [docs/development.md](docs/development.md) to set up a local instance.

## License

MIT. See [LICENSE](LICENSE).
