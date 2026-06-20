# Contextual AI Reader

Contextual AI Reader is a desktop reading companion for English material with AI-assisted Chinese translation, vocabulary explanation, text-to-speech, excerpts, and Markdown file translation.

It can use local AI assistant CLIs such as Codex and Claude Code, or direct API-token backends such as OpenAI and Anthropic.


## Features

- Translate selected text to Simplified Chinese.
- Show the selection popup only when holding `Command` while selecting text.
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
- `Require Command key for auto translate`: keep enabled so normal text selection does not trigger translation.
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

Selection translation:

1. Open a Markdown note or a selectable PDF.
2. Hold `Command` and select English text.
3. The popup appears near the selection.
4. Use the buttons to read aloud, save to excerpts, copy, or refine with AI.

Single-word vocabulary:

1. Hold `Command` and select one English word.
2. The popup shows a local/cache definition immediately when available.
3. The AI context explanation is generated asynchronously using the surrounding paragraph.

Current-file translation:

1. Open a Markdown file.
2. Run `Command Palette -> Translate current Markdown file: append Chinese below`.
3. Or run `Command Palette -> Translate current Markdown file: interleave Chinese paragraphs`.

For long chapters with many tiny EPUB/OCR paragraphs, the plugin automatically merges consecutive short prose paragraphs into larger translation units before sending them to AI. The original English text is preserved, but the Chinese translation may be inserted after a small group of related short paragraphs instead of after every tiny fragment. This greatly reduces repeated prompt and delimiter tokens.

Batch translation:

1. Run one of the batch translation commands from the command palette.
2. Enter one Markdown file, folder, or wildcard per line.
3. The plugin writes directly to the matched Markdown files.

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

Batch paths are vault-relative, not absolute filesystem paths.

```text
Books/Trading in the Zone/
Books/Trading in the Zone/08 - Chapter 1.md
Books/Trading in the Zone/*.md
Books/Trading in the Zone/1? - *.md
Books/Trading in the Zone/**/*.md
```

Supported scope types:

- Single Markdown file.
- Folder, recursively including Markdown files inside it.
- Simple wildcard such as `*.md`.
- Recursive wildcard such as `**/*.md`.

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
4. Create a GitHub release whose tag exactly matches `manifest.json` version, for example `1.0.0`.
5. Upload release assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`
6. Submit the public repository URL to the Obsidian community plugin review process.

## License

MIT
