# Mote

Practice vocabulary in the terminal.

Mote shows one word at a time and resumes at the last position. The list can be today's Maimemo task, a built-in book (`cet4`, `cet6`, `ielts`, `toefl`), or a list imported from a file. Maimemo still owns its review schedule. Practice on this machine is not sent back, and Mote does not choose the next review date.

Requires Node.js 22 or newer. This version runs on macOS only. The command is `mote`. The npm package is `@gengdy/mote`.

## Install

### From npm

```bash
npm install -g @gengdy/mote
```

This installs the published build. It does not use this repository. If `mote` is already on your PATH, add `--force`.

### From this repository

```bash
npm install
npm install -g .
```

`npm install` compiles the program. `npm install -g .` copies that build into npm's global folder. After source changes, run `npm install -g .` again. Moving this directory does not affect the installed command.

## Commands

```text
mote                     Open the current book and resume at the last word
mote review --limit 10   Practice at most 10 words this run
mote lookup apple        Look the word up in Maimemo, then show the phonetic, gloss, phrases, and an example
mote sync                Pull today's Maimemo task and official progress
mote stats               Show today's official progress and how many of those words were revealed locally
mote auth                Verify the API token
mote book                Show the current book
mote book maimemo        Switch to maimemo, cet4, cet6, ielts, toefl, or a custom book
mote book add travel ~/words.txt
                         Import a word list and switch to it. One word per line
mote book remove travel  Delete a custom book
mote fetch               Download missing glosses and audio for the current book
mote fetch cet4          Same, for a named book such as cet4 or travel
```

`mote lookup`, `mote sync`, `mote stats`, and `mote auth` need a Maimemo token. `mote lookup` also requires the word to exist in Maimemo. A built-in or imported book can be practiced without a token.

Opening a word checks the local database and downloads any missing gloss or audio. Those downloads continue after you move to another word. `Space` shows or hides the gloss. Showing it also plays audio when the file is ready, and `p` plays it again. A control stays dim until its data is stored locally. `←` and `→` move between words. `g`, a number, and Enter jump to that position. `Esc` cancels the jump. `q` saves and quits.

`mote fetch` walks one word at a time. For Maimemo, the list is today's task. `mote stats` reads the saved snapshot, so run `mote sync` when that snapshot is missing.

## Configuration

The config file is `~/.config/mote.json`:

```json
{
  "maimemoToken": "Maimemo Open API token",
  "book": "maimemo"
}
```

`book` chooses the list. Maimemo is `"book": "maimemo"`. Built-in books are `cet4`, `cet6`, `ielts`, and `toefl`. A custom name is lowercase, such as `"book": "travel"`. `mote book cet4` writes that field and keeps the token. Each book's position stays where you left it, including after a switch away and back. Importing the same name again replaces the list and returns to the first word. Built-in names cannot be deleted. Their spellings are the `cet4`, `cet6`, `ielts`, and `toefl` tags from [ECDICT](https://github.com/skywind3000/ECDICT) (MIT).

Copy the token from <https://open.maimemo.com/open/api/v1/tokens/openapi>. `mote auth --token <token>` writes the file. `MOTE_MAIMEMO_TOKEN` overrides the file. `MOTE_CONFIG` selects another config path.

`downloadLog` is an optional filesystem path for failed gloss and audio downloads. The default is `~/.local/share/mote/download.log`. A `~` written in the file is not expanded.

Phonetics, glosses, phrases, and examples need no extra key. Opening a word queries Youdao and [dictionaryapi.dev](https://dictionaryapi.dev/) once, then stores the result in local SQLite by spelling. One failed request does not discard a result from the other. Audio files sit beside the database in `audio/` and play with `afplay`.

## Data

Today's words, order, and official completion come from Maimemo. The number of words follows today's official target. A gloss saved in Maimemo replaces the dictionary senses. Phonetics, Chinese glosses, phrases, and the bilingual example come from Youdao. When Youdao has no Chinese gloss, English definitions come from dictionaryapi.dev. Audio uses Youdao's US pronunciation, and uses dictionaryapi.dev when Youdao has no audio file.

If today's task is empty, open the Maimemo app so it can finish the day's initialization, then run `mote sync`.

The database is `~/.local/share/mote/mote.db`. Set `MOTE_DB` to move it. When `XDG_DATA_HOME` is set, the database and the default download log use that directory instead of `~/.local/share`. Maimemo practice is stored per account and per study day. The study day uses Beijing time. A local book's position is stored with that book. The dictionary cache is keyed only by spelling.
