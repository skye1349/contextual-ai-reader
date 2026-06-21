# Contextual AI Reader

[中文文档](README.zh-CN.md)

Contextual AI Reader is a desktop reading companion for English material with AI-assisted Chinese translation, vocabulary explanation, text-to-speech, excerpts, and Markdown file translation.

It can use local AI assistant CLIs such as Codex and Claude Code, or direct API-token backends such as OpenAI and Anthropic.


## Features

- Translate selected text to Simplified Chinese.
- Show the selection popup only when holding the primary modifier key while selecting text: `Command` on macOS, `Ctrl` on Windows/Linux.
- Explain a selected English word with local/cache definitions first, then optionally enrich it with AI using the current paragraph as context.
- Translate selected text from PDFs when Obsidian can select the PDF text layer.
- Read selected English text aloud with the system text-to-speech voice.
- Save selected passages or vocabulary notes to an excerpt note with source references.
- Translate the current Markdown file and append the Chinese translation below the original.
- Translate the current Markdown file into interleaved English/Chinese paragraphs.
- Batch translate multiple Markdown files by file path, folder path, or wildcard.
- Reduce token overhead on long chapters by merging consecutive short prose paragraphs into larger translation units.
- Show token usage after AI calls when the selected backend reports usage.
- Add custom reading context, terminology, and translation style instructions.

## AI Backends

Open plugin settings and choose `AI backend`.

Available modes:

- `Auto`: use local Codex first when available, then local Claude Code.
- `Codex`: use a local Codex executable and your local Codex/ChatGPT login.
- `Claude Code`: use a local Claude Code executable and your local Claude login.
- `OpenAI API token`: call the OpenAI Chat Completions API with your configured API key.
- `Anthropic API token`: call the Anthropic Messages API with your configured API key.

The default mode is `Auto`, so existing local Codex usage remains the default path.

## Configuration

Recommended basic settings:

- `AI backend`: leave as `Auto` if you want Codex first and Claude Code as fallback.
- `Require Command/Ctrl key for auto translate`: keep enabled so normal text selection does not trigger translation.
- `Custom prompt / context`: add the book, domain, terminology, and tone you want the AI to respect.
- `Timeout`: increase this for long full-file or batch translation.
- `Single-shot translation limit`: smaller notes are translated in one request for better context. Defaults to `60000` characters.
- `Batch chunk size`: larger chunks reduce process startup overhead and repeated prompt tokens. Defaults to `30000` characters.

Local backend settings:

- `Codex command`: optional path to `codex`; leave empty to auto-detect.
- `Codex model`: model used by Codex.
- `Reasoning effort`: defaults to `none`, which is usually best for translation speed and cost.
- `Claude command`: optional path to `claude`; leave empty to auto-detect.
- `Claude model`: model used by Claude Code.

On Windows, local CLI mode expects `codex.cmd` or `claude.cmd` to be available in PATH, or you can enter the full command path in settings. API-token modes do not require local CLI installation.

API backend settings:

- `OpenAI API key`: required only when using `OpenAI API token`.
- `OpenAI model`: defaults to `gpt-4.1-mini`.
- `OpenAI base URL`: defaults to `https://api.openai.com/v1`; can be changed for compatible endpoints.
- `Anthropic API key`: required only when using `Anthropic API token`.
- `Anthropic model`: defaults to `claude-sonnet-4-5`.
- `Anthropic base URL`: defaults to `https://api.anthropic.com/v1`.

API keys are stored in this plugin's local Obsidian settings data. Do not publish your vault's `.obsidian/plugins/.../data.json` file.

Example custom prompt:

```text
I am reading Poor Charlie's Almanack. Translate into natural Simplified Chinese.
Keep investment, psychology, and business terms consistent. Preserve Markdown structure.
```

## Usage

### Selection Popup

By default, normal text selection does nothing. This avoids interrupting ordinary note-taking.

To open the popup:

1. Open a Markdown note or a selectable PDF.
2. Hold the primary modifier key: `Command` on macOS, `Ctrl` on Windows/Linux.
3. While holding that key, select English text.
4. Release the mouse or trackpad.
5. The popup appears near the selected text.

If you turn off `Require Command/Ctrl key for auto translate`, the popup appears after ordinary text selection. This is not recommended for heavy note-taking workflows.

### Popup Buttons

The popup can show different buttons depending on the selected text and result state:

- Speaker: read the original English text aloud with the system text-to-speech voice.
- Sparkles: send the selection to the configured AI backend for a higher-quality translation or contextual explanation.
- Book plus: save the selection, translation, or vocabulary note to the configured excerpt note.
- Copy: copy the translation or vocabulary note to the system clipboard.
- Stop: cancel a running AI request and kill the active local CLI process when using Codex or Claude Code.

### Paragraph Translation

When you select a phrase, sentence, or paragraph:

1. Hold `Command` on macOS or `Ctrl` on Windows/Linux, then select the text.
2. The plugin first tries a quick translation for the popup.
3. Click the Sparkles button if you want the configured AI backend to refine the translation.
4. Use Copy or Book plus if you want to keep the result.

For selected paragraphs, the quick popup translation is meant for speed. The Sparkles button is the higher-quality AI path and uses your selected backend, custom prompt, model, and token budget.

### Single-Word Vocabulary

When you select exactly one English word:

1. Hold `Command` on macOS or `Ctrl` on Windows/Linux, then select the word.
2. The popup first checks the local vocabulary cache and built-in dictionary.
3. If a local/cache definition exists, it appears immediately.
4. The plugin then uses the surrounding paragraph and your custom prompt to generate an AI context explanation.
5. Use Book plus to save the vocabulary note, including the source context.

Single-word mode is different from paragraph translation: it focuses on what the word means in the current paragraph or book, not only on a generic dictionary definition.

### Selection Commands

You can also use commands from the command palette:

- `Translate selection to Chinese`: replaces the selected text with Chinese.
- `Append Chinese translation below selection`: keeps the original selection and inserts the Chinese translation below it.
- `Speak selected English text`: reads the selected English text aloud.
- `Save selection to excerpts`: saves the selected text to your excerpt note with source information.

### Current Markdown File Translation

1. Open a Markdown file.
2. Open the command palette.
3. Run one of the current-file translation commands.

Available modes:

- `Translate current Markdown file: append Chinese below`
- `Translate current Markdown file: interleave Chinese paragraphs`

Append mode:

```text
Original English content

Chinese translation of the whole note
```

Use this when you want to keep the English source intact and place the full Chinese translation after it.

Interleave mode:

```text
English paragraph 1

Chinese paragraph 1

English paragraph 2

Chinese paragraph 2
```

Use this when you want side-by-side reading in one note. For long chapters with many tiny EPUB/OCR paragraphs, the plugin automatically merges consecutive short prose paragraphs into larger translation units before sending them to AI. The original English text is preserved, but the Chinese translation may be inserted after a small group of related short paragraphs instead of after every tiny fragment. This greatly reduces repeated prompt and delimiter tokens.

Only one full-file or batch translation can run at a time. If another translation is already running, the plugin asks you to stop the current task first.

### Batch Markdown Translation

Use batch translation when you want to translate multiple Markdown files with one command.

1. Open the command palette.
2. Run one of the batch commands:
   - `Batch translate Markdown files: append Chinese below`
   - `Batch translate Markdown files: interleave Chinese paragraphs`
3. Enter one Markdown file, folder, or wildcard per line.
4. Click Start.

Batch commands write directly to the matched Markdown files. Back up important notes before running them.

### Batch Path Rules

Batch paths are vault-relative. Do not use absolute filesystem paths.

Correct:

```text
Books/Trading in the Zone/
Books/Trading in the Zone/08 - Chapter 1.md
Books/Trading in the Zone/*.md
Books/Trading in the Zone/1? - *.md
Books/Trading in the Zone/**/*.md
```

Incorrect:

```text
/Users/me/Documents/Vault/Books/Trading in the Zone/
```

Supported scopes:

- Single Markdown file: `Books/Example/Chapter 1.md`
- Folder: `Books/Example/`
- Simple wildcard: `Books/Example/*.md`
- Recursive wildcard: `Books/Example/**/*.md`
- Single-character wildcard: `Books/Example/1? - *.md`

The folder mode recursively includes Markdown files inside the folder.

### Excerpts

Set `Excerpt file` in plugin settings. When you click Book plus or run `Save selection to excerpts`, the plugin appends an entry to that note.

Excerpt entries can include:

- the original selected text;
- the popup translation when available;
- the source note path;
- line references when the selection comes from an open Markdown editor.

If `Open excerpt file after saving` is enabled, the excerpt note opens in a side split after saving.

### Text-to-Speech

Use the Speaker button or the `Speak selected English text` command to read selected English aloud.

Useful settings:

- `Speech language`: defaults to `en-US`.
- `Speech rate`: defaults to `0.92`.

The plugin uses the system speech synthesis voices available in your Obsidian desktop environment.

### Token Usage And Cancellation

AI-powered actions show token usage when the selected backend reports it.

The token line uses this format:

```text
input ↑ output ↓ (total, cached)
```

For long file translation, the progress overlay also shows:

- elapsed time;
- completed batches;
- completed translation units;
- completed source paragraphs;
- current token usage;
- a Stop button.

Click Stop to cancel queued work and kill active local CLI processes where possible.

### Custom Prompt / Reading Context

Use `Custom prompt / context` to tell the AI what you are reading and how it should translate.

Good examples:

```text
I am reading Poor Charlie's Almanack. Translate in natural Simplified Chinese.
Keep investing, psychology, business, and Munger-related terms consistent.
```

```text
I am reading a trading psychology book. Preserve technical trading terms.
Translate "edge" as "优势" when it means trading advantage.
```

The custom prompt affects AI refinement, contextual vocabulary explanation, current-file translation, and batch translation. It does not affect the instant local/cache vocabulary lookup.

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

Batch paths are vault-relative, not absolute filesystem paths. See `Batch Path Rules` above for the full behavior.

```text
Books/Trading in the Zone/
Books/Trading in the Zone/08 - Chapter 1.md
Books/Trading in the Zone/*.md
Books/Trading in the Zone/1? - *.md
Books/Trading in the Zone/**/*.md
```

## Privacy

This plugin is not offline translation.

Depending on your selected backend, selected text and Markdown content may be sent to:

- local Codex CLI/App through your local Codex login;
- local Claude Code through your local Claude login;
- OpenAI API using your configured API key;
- Anthropic API using your configured API key.

The plugin stores settings locally in Obsidian. It does not intentionally publish or upload settings, but API keys stored in plugin settings are sensitive. Do not commit Obsidian plugin data files to a public repository.

Full-file and batch translation commands modify Markdown files directly. Back up important vaults before running bulk operations.

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Manual development install:

```text
<vault>/.obsidian/plugins/contextual-ai-reader/
```

The plugin folder must contain:

- `manifest.json`
- `main.js`
- `styles.css`

## Community Plugin Release Checklist

1. Update `manifest.json` and `versions.json`.
2. Run `npm run build`.
3. Commit `main.js`, `manifest.json`, `styles.css`, and source files.
4. Push `main`.
5. Push a Git tag whose name exactly matches `manifest.json` version, for example `1.0.3`.
6. Let the GitHub Actions release workflow create the release assets and artifact attestations.
7. After the release is published, users can update from the Obsidian community plugin browser.

## License

MIT
