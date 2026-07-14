# Contextual AI Reader

[中文](https://github.com/skye1349/contextual-ai-reader/blob/main/README.zh-CN.md) · [日本語](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ja.md) · [한국어](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ko.md) · [Español](https://github.com/skye1349/contextual-ai-reader/blob/main/README.es.md) · [Français](https://github.com/skye1349/contextual-ai-reader/blob/main/README.fr.md) · [Deutsch](https://github.com/skye1349/contextual-ai-reader/blob/main/README.de.md)

Contextual AI Reader is an Obsidian desktop reading companion for translation, contextual vocabulary, text-to-speech, excerpts, PDFs, Markdown, and language learning with YouTube transcripts.

It supports configurable language direction: choose the language you are reading, or let the plugin auto-detect it, then choose the language you want to learn with. The default is auto-detect source language and Simplified Chinese as the target language.

The plugin can use local AI assistant CLIs such as Codex and Claude Code, or direct API-token backends such as OpenAI and Anthropic.

## Features

- Translate selected text into your configured target language.
- Show the selection popup only when holding the primary modifier key while selecting text: `Command` on macOS, `Ctrl` on Windows/Linux.
- Explain selected vocabulary with local/cache results first, then optionally enrich it with AI using the current paragraph as context.
- Use the built-in local English-to-Chinese dictionary when the target language is Chinese; other language pairs use quick translation, cache, and optional AI context.
- Translate selected text from PDFs when Obsidian can select the PDF text layer.
- Read selected text aloud with the system text-to-speech voice.
- Save selected passages or vocabulary notes to an excerpt note with source references.
- Translate the current Markdown file and append the target-language translation below the original.
- Translate the current Markdown file into interleaved source/target-language paragraphs.
- Batch translate multiple Markdown files by file path, folder path, or wildcard.
- Reduce token overhead on long chapters by merging consecutive short prose paragraphs into larger translation units.
- Show token usage after AI calls when the selected backend reports usage.
- Add custom reading context, terminology, and translation style instructions.
- Open a YouTube link in an Obsidian learning-player tab with sentence-level interactive captions.
- Translate captions in context, follow the current spoken sentence, and click any subtitle to seek the video.
- Capture only the video frame into a Markdown note with a clickable timestamp back to the player.
- Create a transcript note with source text, translations, and clickable timestamps.

## AI Backends

Open plugin settings and choose `AI backend`.

- `Auto`: use local Codex first when available, then local Claude Code.
- `Codex`: use a local Codex executable and your local Codex/ChatGPT login.
- `Claude Code`: use a local Claude Code executable and your local Claude login.
- `OpenAI API token`: call the OpenAI Chat Completions API with your configured API key.
- `Anthropic API token`: call the Anthropic Messages API with your configured API key.

The default mode is `Auto`, so existing local Codex usage remains the default path.

## Configuration

Recommended basic settings:

- `Source language`: choose the source language or leave it as `Auto detect`.
- `Learning / target language`: choose the language used for translations and vocabulary explanations.
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

1. Open a Markdown note or a selectable PDF.
2. Hold the primary modifier key: `Command` on macOS, `Ctrl` on Windows/Linux.
3. While holding that key, select text.
4. Release the mouse or trackpad.
5. The popup appears near the selected text.

If you turn off `Require Command/Ctrl key for auto translate`, the popup appears after ordinary text selection.

### Popup Buttons

- Speaker: read the original selected text aloud.
- Sparkles: send the selection to the configured AI backend for a higher-quality translation or contextual explanation.
- Book plus: save the selection, translation, or vocabulary note to the configured excerpt note.
- Copy: copy the translation or vocabulary note to the system clipboard.
- Stop: cancel a running AI request and kill the active local CLI process when using Codex or Claude Code.

### Paragraph Translation

When you select a phrase, sentence, or paragraph, the plugin first tries a quick translation for speed. Click Sparkles if you want the configured AI backend to refine the translation with your custom prompt, model, and target language.

### Vocabulary Explanation

When you select a single word or short term, the plugin enters vocabulary mode:

1. It checks the local vocabulary cache.
2. For English-to-Chinese, it also checks the built-in local dictionary.
3. If needed, it uses quick translation for an instant base meaning.
4. It can then use AI to explain what the word means in the current paragraph or book context.

This is different from normal translation: it focuses on the meaning in context.

### Selection Commands

You can also use commands from the command palette:

- `Translate selection to target language`: replaces the selected text with the target-language translation.
- `Append target-language translation below selection`: keeps the original selection and inserts the translation below it.
- `Speak selected text`: reads the selected text aloud.
- `Save selection to excerpts`: saves the selected text to your excerpt note with source information.

### Current Markdown File Translation

Open a Markdown file and run one of these commands:

- `Translate current Markdown file: append target language below`
- `Translate current Markdown file: interleave target-language paragraphs`

Append mode:

```text
Original source-language content

Target-language translation of the whole note
```

Interleave mode:

```text
Source paragraph 1

Target paragraph 1

Source paragraph 2

Target paragraph 2
```

For long chapters with many tiny EPUB/OCR paragraphs, the plugin automatically merges consecutive short prose paragraphs into larger translation units before sending them to AI. The original text is preserved, but the translation may be inserted after a small group of related short paragraphs instead of after every tiny fragment. This greatly reduces repeated prompt and delimiter tokens.

Only one full-file or batch translation can run at a time. If another translation is already running, the plugin asks you to stop the current task first.

### Batch Markdown Translation

Use batch translation when you want to translate multiple Markdown files with one command.

1. Open the command palette.
2. Run one of the batch commands:
   - `Batch translate Markdown files: append target language below`
   - `Batch translate Markdown files: interleave target-language paragraphs`
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

## Excerpts

Set `Excerpt file` in plugin settings. When you click Book plus or run `Save selection to excerpts`, the plugin appends an entry to that note.

Excerpt entries can include the original text, popup translation, vocabulary note, source note path, and line references when available.

Vocabulary entries stay in the same main excerpt file, but each vocabulary card includes reusable inline metadata fields:

```text
- type:: vocabulary
- term:: private
- status:: new
- source_language:: en
- target_language:: ja
- created:: 2026-06-21
- source:: [[Books/Test Chapter.md]]
- tags:: #vocabulary #language/ja #status/new
```

This keeps the notebook simple while still allowing Obsidian search, tags, and Dataview-style filtering by language, status, source note, or topic.

## YouTube Learning Player (Development Preview)

Run `Open YouTube learning player` from the command palette and paste a `youtube.com` or `youtu.be` link. The plugin opens the video in an Obsidian tab and displays a sentence-level transcript beside it. Captions are merged into readable sentences instead of showing every tiny automatic-caption fragment.

The transcript follows playback automatically. Click a sentence or its timestamp to seek the existing player to that moment. The toolbar provides play, pause, video-frame capture, transcript-note creation, contextual AI translation, stop, and open-on-YouTube controls.

Screenshot capture writes only the visible player rectangle to the configured `YouTube screenshot folder`, then inserts the image and a clickable timestamp into the most recently used Markdown note. `Create note from current YouTube transcript` writes a reusable Markdown transcript to the configured `YouTube transcript folder`.

The plugin first attempts caption extraction without an extra program. YouTube increasingly protects signed caption URLs, so some videos require [yt-dlp](https://github.com/yt-dlp/yt-dlp). Install it and leave `yt-dlp command` empty for auto-detection, or enter its full path in plugin settings. `yt-dlp` is used only to resolve metadata and subtitle URLs; this feature does not download the video.

Some owners disable playback on other websites. The plugin cannot bypass that YouTube restriction; use the toolbar's external-link button for those videos. Captions and transcript notes may still be available.

## Token Usage And Cancellation

AI-powered actions show token usage when the selected backend reports it.

```text
input ↑ output ↓ (total, cached)
```

For long file translation, the progress overlay shows elapsed time, completed batches, completed translation units, completed source paragraphs, current token usage, and a Stop button.

Click Stop to cancel queued work and kill active local CLI processes where possible.

## Privacy

This plugin is not offline translation.

Depending on your selected backend, selected text and Markdown content may be sent to local Codex CLI/App, local Claude Code, OpenAI API, or Anthropic API. Settings are stored locally in Obsidian. API keys in plugin settings are sensitive and should not be committed to a public repository.

Full-file and batch translation commands modify Markdown files directly. Back up important vaults before running bulk operations.

## Development

```bash
npm install
npm run build
```

The plugin folder must contain `manifest.json`, `main.js`, and `styles.css`.

To build a local plugin that can coexist with the Marketplace version in a separate test vault:

```bash
npm run build:dev-plugin
```

Install the generated `dist-dev/contextual-ai-reader-dev` folder under the test vault's `.obsidian/plugins/` directory. It uses the separate plugin ID `contextual-ai-reader-dev` and the display name `Contextual AI Reader Dev`. This does not change the release version or create a tag.

Or build and install it into a test vault in one command:

```bash
npm run install:dev-plugin -- "/absolute/path/to/Test Vault"
```

## License

MIT
