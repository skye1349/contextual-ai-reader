# Contextual AI Reader 日本語

[English](https://github.com/skye1349/contextual-ai-reader/blob/main/README.md) · [中文](https://github.com/skye1349/contextual-ai-reader/blob/main/README.zh-CN.md) · [한국어](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ko.md) · [Español](https://github.com/skye1349/contextual-ai-reader/blob/main/README.es.md) · [Français](https://github.com/skye1349/contextual-ai-reader/blob/main/README.fr.md) · [Deutsch](https://github.com/skye1349/contextual-ai-reader/blob/main/README.de.md)

Contextual AI Reader は、Obsidian デスクトップ用の読書補助プラグインです。選択テキストの翻訳、文脈に基づく語彙説明、読み上げ、抜粋ノート、PDF の選択テキスト翻訳、Markdown ファイル全体の翻訳に対応します。

## システム要件とインストール

macOS、Windows、Linux の Obsidian デスクトップ版を使用してください。モバイル版では同期済みノートを読めますが、ローカル CLI や動画ツールは実行できません。Community Plugins からのインストールには Node.js、npm、ソースコードは不要です。AI バックエンドを一つ選びます。

- Codex: [Codex App または CLI](https://developers.openai.com/codex/cli) をインストールし、CLI では `codex login` を実行します。
- Claude Code: Claude Code をインストールしてログインします。
- API: OpenAI または Anthropic の API key を設定します。ローカル CLI は不要です。

YouTube の保護された字幕、動画フレームの保存、CC がない動画の文字起こしには追加ツールが必要です。

| OS | `yt-dlp` と `ffmpeg` のインストール |
| --- | --- |
| macOS | `brew install yt-dlp ffmpeg` |
| Windows | `winget install yt-dlp.yt-dlp` と `winget install Gyan.FFmpeg` |
| Ubuntu/Debian | `sudo apt update && sudo apt install yt-dlp ffmpeg` |
| その他の Linux | ディストリビューションのパッケージマネージャーを使用 |

インストール後に Obsidian を再起動してください。自動検出できない場合は、設定で実行ファイルのフルパスを指定します。CC がない動画の文字起こしには Groq または OpenAI API key も必要です。

## ローカルデータとキャッシュ

設定、API key、語彙キャッシュ、YouTube 字幕と翻訳は Vault ごとの `<vault>/.obsidian/plugins/contextual-ai-reader/data.json` に保存されます。キャッシュを保持するには、`data.json`、プラグインフォルダー、プラグインデータを削除しないでください。Vault を変更する場合はこのファイルを私的にコピーしてください。

YouTube キャッシュは最近の 30 本を保持します。画像と生成した transcript note は通常の Vault ファイルなので、キャッシュを消しても削除されません。`data.json` には API key が含まれる場合があるため、公開・共有・Git への commit はしないでください。

## 主な機能

- 原文言語を選択、または自動検出できます。
- 翻訳と語彙説明の出力先となる学習言語を選択できます。
- macOS では `Command`、Windows/Linux では `Ctrl` を押しながらテキストを選択するとポップアップが表示されます。
- 短い語句はまずキャッシュと高速翻訳を使い、必要に応じて AI が現在の段落に基づいて説明します。
- 目標言語が中国語で英単語を選択した場合、内蔵の英中ミニ辞書も使われます。
- 現在の Markdown ファイルを翻訳し、末尾に追加できます。
- 現在の Markdown ファイルを段落ごとの対訳形式にできます。
- ファイル、フォルダ、ワイルドカードで複数の Markdown ファイルを一括翻訳できます。
- AI バックエンドが対応している場合、token usage を表示します。

## AI バックエンド

設定画面の `AI backend` で選択します。

- `Auto`: ローカル Codex を優先し、見つからなければ Claude Code を使います。
- `Codex`: ローカル Codex CLI とログイン済みアカウントを使います。
- `Claude Code`: ローカル Claude Code CLI とログイン済みアカウントを使います。
- `OpenAI API token`: OpenAI API key を使います。
- `Anthropic API token`: Anthropic API key を使います。

## 基本設定

- `Source language`: 読んでいるテキストの言語。迷ったら `Auto detect`。
- `Learning / target language`: 翻訳と語彙説明の出力言語。
- `Require Command/Ctrl key for auto translate`: 通常の選択で誤動作しないよう、有効のままがおすすめです。
- `Custom prompt / context`: 本、分野、用語、文体の希望を書きます。
- `Reasoning effort`: 翻訳用途では通常 `none` が速くて安価です。

## 使い方

1. Markdown ノート、または選択可能な PDF を開きます。
2. macOS では `Command`、Windows/Linux では `Ctrl` を押したままテキストを選択します。
3. ポップアップが表示されます。
4. Sparkles ボタンで AI による高品質翻訳または文脈説明を実行できます。
5. Copy でコピー、Book plus で抜粋ノートに保存できます。

## Markdown ファイル翻訳

Command Palette から次のコマンドを実行します。

- `Translate current Markdown file and append translation`
- `Translate current Markdown file with interleaved translation`

一括翻訳では vault からの相対パスを入力します。絶対パスは使いません。

```text
Books/Example/
Books/Example/Chapter 1.md
Books/Example/*.md
Books/Example/**/*.md
```

## プライバシー

このプラグインは完全なオフライン翻訳ではありません。選択テキストや Markdown 内容は、選択したバックエンドに応じて Codex、Claude Code、OpenAI API、Anthropic API に送信される場合があります。API key は Obsidian のローカル設定に保存されます。

## License

MIT
