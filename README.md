# Mote

Practice vocabulary in the terminal.

Mote shows one word at a time. The list may be today's Maimemo task, a built-in book, a book created in Mote, or a list imported from a file.

Requires Node.js 22 or newer, on macOS and Linux. The command is `mote`. The npm package is `@gengdy/mote`.

## Install

### From npm

```bash
npm install -g @gengdy/mote
```

This installs the published build, not this repository. If `mote` is already on the PATH, add `--force`.

### From this repository

```bash
npm install
npm install -g .
```

`npm install` compiles the program. `npm install -g .` copies that build into the global folder of npm. After source changes, run it again. Moving this directory does not affect the installed command.

## Commands

```text
mote                     Open the current book at the last word
mote lookup apple        Show the card and play it once
mote sync                Pull today's Maimemo task and official progress
mote stats               Show the official progress
mote auth                Verify the API token
mote words               Page through the current book
mote book                Show the current book
mote book maimemo        Switch to maimemo, cet4, cet6, ielts, toefl, or a custom book
mote book create travel  Create an empty book and switch to it
mote books               Show the book directory
mote books ~/books       Move custom books into that directory
mote add apple           Append a word to the current book
mote book add travel ~/words.txt
                         Import a file as a book and switch to it
mote book travel add apple
                         Append a word without switching books
mote book remove travel  Delete a custom book
mote fetch               Download missing glosses and audio
mote fetch cet4          Download them for a named book
```

`mote sync`, `mote stats`, and `mote auth` need a Maimemo token. Practice, `mote words`, and `mote fetch` need one only on the Maimemo book.

`mote book create` refuses an existing name or file. `mote book add` copies the file and leaves the original in place. An existing name overwrites that book after confirmation. `mote book remove` asks before deleting. `mote books ~/books` moves only the book files. Built-in books cannot be deleted.

## Configuration

The config file is `~/.config/mote.json`:

```json
{
  "book": "maimemo",
  "pageSize": 7,
  "dbPath": "/absolute/path/mote.db",
  "booksPath": "/absolute/path/books",
  "logPath": "/absolute/path/mote.log",
  "maimemoToken": "Maimemo Open API token"
}
```

`book` stores the current choice. A custom name is lowercase. Editing or replacing the word list returns to the first word. The built-in spellings are the `cet4`, `cet6`, `ielts`, and `toefl` tags from [ECDICT](https://github.com/skywind3000/ECDICT), Copyright (c) 2025 Linwei, MIT License. That license covers the lists. The license of Mote does not replace it. The notice is in `NOTICE`.

Copy the token from <https://open.maimemo.com/open/api/v1/tokens/openapi>. `mote auth --token <token>` writes the file.

The first run writes `book`, `dbPath`, `logPath`, `booksPath`, and `pageSize`. `dbPath` defaults to `~/.local/share/mote/mote.db`, `logPath` to `~/.local/share/mote/mote.log`, and `booksPath` to `books/` beside the database, where every custom book is `{name}.txt`. Book names are listed in `books.json` beside the database. `pageSize` defaults to 7. Errors are appended to `logPath`.

A leading `~` in `dbPath`, `logPath`, `booksPath`, or an imported word list expands to the home directory. Relative paths are accepted. Messages show the absolute path. An unresolvable path such as `~someone` is reported.

## Data

Today's words, order, and official completion come from Maimemo. The count follows that day's official target, up to 1000. If the task is empty, open the Maimemo app and run `mote sync`. Maimemo practice is stored per account and per study day in Beijing time. The review schedule stays with Maimemo. Practice on this machine is not sent back, and Mote does not choose the next review date. The position of a local book is stored with that book.

Phonetics, glosses, phrases, and examples come from Youdao and [dictionaryapi.dev](https://dictionaryapi.dev/), with no extra key. Chinese senses are shown when Youdao has them. Otherwise the card shows English senses from dictionaryapi.dev. Audio uses the US pronunciation from Youdao, or dictionaryapi.dev when Youdao has no audio file. Files are stored in `audio/` beside the database and play with `afplay` on macOS, or `ffplay` or `mpv` on Linux.
