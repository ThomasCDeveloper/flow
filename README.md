# flow

A browser-based tool for writing books. Each book is a folder on disk, each chapter is a Markdown file, and the whole book can be exported to EPUB.

## Quick start

Requires Node.js 20 or newer.

```sh
make install
make start
```

Then open http://localhost:4321.

To work on flow itself, run `make dev` and open http://localhost:5173. The web UI reloads on change and the server restarts on change.

| Command          | What it does                                     |
| ---------------- | ------------------------------------------------ |
| `make install`   | Install dependencies                             |
| `make dev`       | Server and web UI with hot reload (port 5173)    |
| `make build`     | Build the web UI into `web/dist`                 |
| `make start`     | Build and serve the app (port 4321)              |
| `make typecheck` | Type-check server and web UI                     |
| `make clean`     | Remove build output and `node_modules`           |

Use a different port with `make start PORT=8080`.

## Using flow

- **Home**: recent projects, **New project** (title, author, folder location) and **Open folder…**, which browses your disk. Any folder of `.md` files can be opened.
- **Tabs**: several projects can be open at once, one per tab.
- **Chapters**: the sidebar lists chapters in reading order. Drag to reorder. Double-click or use the pencil icon to rename, which also updates the chapter's `# Heading` and filename. Use **+ New chapter** to add one.
- **Notes**: a separate sidebar section for ideas, research, characters, anything that isn't part of the book. Notes are Markdown files too, edited in the same editor.
- **Chapter notes**: the collapsible "Chapter notes" panel above the editor holds notes for the open chapter (a dot shows when a collapsed chapter has notes).
- **Board**: the **Board** button in the toolbar shows the chapters as cards in four columns: To write, Started, Good enough and Finished. Drag a card to another column to change its status. Cards stay in reading order, and clicking one opens the chapter in the editor.
- **Editor**: Markdown editor with an optional side-by-side **Preview**. Changes save automatically after a short pause; `Ctrl+S` saves immediately. The status bar shows word counts for the chapter and the whole book.
- **Focus mode**: `Ctrl+Shift+F` (`⌘⇧F` on Mac), or the **Focus** button in the toolbar, hides everything but the Markdown editor: tabs, sidebar, toolbar, chapter notes, preview and status bar. Press the shortcut again or `Esc` to bring them back.
- **Book details**: click the book title at the top of the sidebar to edit title, author, language and cover image.
- **Export EPUB**: downloads an EPUB 3 file of the whole book.

## Project format

```
my-book/
  flow.json          # metadata and chapter order
  chapters/
    01-intro.md
    02-the-storm.md
  notes/             # free-form notes, never exported
    characters.md
  assets/            # images, cover
```

`flow.json`:

```json
{
  "title": "My Book",
  "author": "Jane Doe",
  "language": "en",
  "identifier": "urn:uuid:...",
  "chaptersDir": "chapters",
  "chapters": ["01-intro.md", "02-the-storm.md"],
  "notesDir": "notes",
  "chapterNotes": { "02-the-storm.md": "Foreshadow the flood here." },
  "chapterStatus": { "01-intro.md": "done", "02-the-storm.md": "started" },
  "cover": "assets/cover.jpg"
}
```

- Notes (`notes/`) and chapter notes (`chapterNotes`) are never included in the EPUB. Chapter notes follow their chapter when it is renamed and are removed when it is deleted.
- `chapterStatus` holds each chapter's board column: `started`, `good` (good enough) or `done` (finished). Chapters not listed are "to write". It is never exported, and it follows renames and deletes the same way chapter notes do.

- A chapter's title is its first `# Heading`, or the filename if it has none.
- Opening a folder without `flow.json` creates one. If the folder has loose `.md` files and no `chapters/` folder, they are used in place (`"chaptersDir": "."`) rather than moved.
- Files added or removed outside flow are picked up the next time the project loads: new files are appended to the order, missing ones are dropped.
- Images are referenced relative to the chapter file, for example `![Map](../assets/map.png)`.

The list of recent projects is stored in `~/.config/flow/config.json`. Set `FLOW_CONFIG_DIR` to use another location.

## EPUB export

The export produces a valid EPUB 3 file with an EPUB 2 table of contents for older readers. It includes:

- one page per chapter, in sidebar order
- a table of contents built from chapter titles
- a cover page, if a cover is set
- local images used in chapters
- links between chapters (`[next](02-the-storm.md)`), rewritten to point inside the book

Remote images and links to files that aren't chapters can't be packaged, so they are replaced by their alt text or plain text.

To validate an export with [EPUBCheck](https://github.com/w3c/epubcheck):

```sh
java -jar epubcheck.jar "My Book.epub"
```

## Architecture

```
server/   Fastify API (TypeScript, run with tsx)
  src/index.ts     routes, static file serving
  src/projects.ts  project open/create, flow.json, path safety
  src/chapters.ts  chapter read/write/create/rename/delete/reorder, chapter notes
  src/notes.ts     free-form notes
shared/   Markdown rendering shared by preview and export (dialogue dashes)
  src/epub.ts      EPUB builder (marked + jszip)
  src/config.ts    recent projects
web/      React + Vite UI, CodeMirror 6 editor
```

The server listens on `127.0.0.1` only. It rejects requests whose `Host` header isn't localhost, and every write request must send an `X-Flow: 1` header, so other websites open in your browser can't modify your files. All file paths are checked to stay inside the project folder.
