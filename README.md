# Codex Local Translator for Obsidian

Translate selected text, whole notes, or batches of Markdown files in Obsidian through the locally logged-in Codex CLI.

> This is an unofficial community plugin. It is not affiliated with OpenAI or Obsidian.

![Selection translation popup](docs/assets/selection-popup.svg)

## What It Does

- Translate selected Markdown to Simplified Chinese.
- Show a translation popup only when you hold `Command` while selecting text.
- Read selected English text aloud with the system text-to-speech voice.
- Save selected passages to an excerpt note with source file and line references.
- Translate the current Markdown file and append the Chinese version below the original.
- Translate the current Markdown file into interleaved English/Chinese paragraphs.
- Batch translate multiple Markdown files by file path, folder path, or wildcard.
- Use a custom prompt/context for book, domain, terminology, or style guidance.

## Requirements

- Obsidian desktop. This plugin is desktop-only.
- Codex installed locally, either through Codex.app or the Codex CLI.
- A Codex login using your ChatGPT account.

This plugin does not use an OpenAI API key. It shells out to a local `codex` executable and uses your existing Codex login.

## Privacy And Data

Selected text and Markdown file contents are sent to Codex for translation through the local Codex executable. This is not offline translation.

The plugin stores only local plugin settings in your vault, such as model name, timeout, excerpt note path, and custom prompt. It does not store API keys.

Batch and full-file commands write directly to your Markdown files. Back up your vault before running bulk operations on important notes.

## Screenshots

### Selection Popup

Hold `Command` while selecting text to show a translation popup. The popup includes read-aloud, excerpt, and copy actions.

![Selection translation popup](docs/assets/selection-popup.svg)

### Full Note Translation

Full-note commands can append the full Chinese translation at the bottom or insert Chinese text after each source paragraph.

![Full note commands](docs/assets/full-note-commands.svg)

### Batch Translation

Batch commands accept one file, folder, or wildcard per line.

![Batch translation modal](docs/assets/batch-modal.svg)

## Commands

- `Translate selection to Chinese`
- `Append Chinese translation below selection`
- `Speak selected English text`
- `Save selection to excerpts`
- `Translate current Markdown file: append Chinese below`
- `Translate current Markdown file: interleave Chinese paragraphs`
- `Batch translate Markdown files: append Chinese below`
- `Batch translate Markdown files: interleave Chinese paragraphs`
- `Check Codex login`

## Batch Scope Examples

Batch commands accept vault-relative paths, not absolute filesystem paths:

```text
Books/Example Book/
Books/Example Book/08 - Chapter 1.md
Books/Example Book/*.md
Books/Example Book/**/*.md
```

Supported scope types:

- Single Markdown file.
- Folder, recursively including Markdown files inside it.
- Simple wildcard such as `*.md`.
- Recursive wildcard such as `**/*.md`.

## Settings

- `Auto translate selection`: show a popup after text is selected.
- `Require Command key for auto translate`: only show the popup when `Command` is held during selection. Enabled by default.
- `Custom prompt / context`: add book, topic, terminology, style, or translation preferences.
- `Excerpt file`: vault path for saved passages.
- `Open excerpt file after saving`: open the excerpt note in a right-side split.
- `Include translation in excerpts`: save the popup translation when available.
- `Speech language`: defaults to `en-US`.
- `Speech rate`: defaults to `0.92`.
- `Codex command`: leave empty to auto-detect Codex.app or a local CLI.
- `Model`: defaults to `gpt-5.4-mini`.
- `Reasoning effort`: defaults to `none`.
- `Timeout`: maximum seconds for each Codex invocation.

Example custom prompt:

```text
I am reading a trading psychology book. Translate in natural Simplified Chinese,
preserve Markdown structure, and keep recurring trading terms consistent.
```

## Local Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Manual install for development:

```text
<vault>/.obsidian/plugins/codex-local-translator/
```

The plugin folder must contain:

- `manifest.json`
- `main.js`
- `styles.css`

## Release Checklist

For an Obsidian Community Plugin release:

1. Update `manifest.json` and `versions.json`.
2. Run `npm run build`.
3. Commit `main.js`, `manifest.json`, `styles.css`, and source files.
4. Create a GitHub release whose tag exactly matches `manifest.json` version, for example `1.0.0`.
5. Upload release assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`
6. Submit the public repository URL through the Obsidian Community directory.

## License

MIT
