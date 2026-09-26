# Read & Watch with AI 日本語

[English](https://github.com/skye1349/contextual-ai-reader/blob/main/README.md) · [中文](https://github.com/skye1349/contextual-ai-reader/blob/main/README.zh-CN.md) · [한국어](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ko.md) · [Español](https://github.com/skye1349/contextual-ai-reader/blob/main/README.es.md) · [Français](https://github.com/skye1349/contextual-ai-reader/blob/main/README.fr.md) · [Deutsch](https://github.com/skye1349/contextual-ai-reader/blob/main/README.de.md)

## 1.2.0：名称変更と API 設定

**Contextual AI Reader** は **Read & Watch with AI** に名称変更しました。内部 ID とリポジトリ URL は維持し、設定・字幕キャッシュ・会話履歴は引き続き利用できます。保存済みの出力先は変えず、新規インストールでは新名称を使います。

**AI backend** で **OpenAI-compatible API** または **Anthropic API token** を選び、対応するキー、ベース URL、モデル ID を入力します。OpenAI は `https://api.openai.com/v1`、Claude は `https://api.anthropic.com/v1` です。Codex・Claude Code・Node.js・CLI の契約は不要です。選択範囲/PDF テキスト、語彙説明、ノート全体・一括翻訳、字幕翻訳、動画要約、追加質問、画像質問に使えます。画像には画像対応モデルが必要です。**Test text / Test image** は小さな接続テストを送信し、画像には合成画像を使います。料金が発生する場合があります。

**Auto** は OpenAI 互換キー、Anthropic キー、ローカル CLI の順で選びます。キーを保存していてもローカルログインを使う場合は **Codex** を明示的に選びます。字幕のない音声は **Transcription API key / base URL / model** または Groq を別途設定してください。サービスは `/audio/transcriptions`、`verbose_json`、時刻付き区間をサポートする必要があります。同じベース URL の場合だけチャットキーを再利用します。Claude キーでは OpenAI Whisper を呼び出せません。任意のキーやモデルがすべての機能に対応するわけではありません。CC 抽出、スクリーンショット、システム読み上げには AI キーは不要です。

Read & Watch with AI は、Obsidian デスクトップ用の読書補助プラグインです。選択テキストの翻訳、文脈に基づく語彙説明、読み上げ、抜粋ノート、PDF の選択テキスト翻訳、Markdown ファイル全体の翻訳に対応します。

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

- `Auto`: OpenAI 互換キー、Anthropic キー、ローカル CLI の順で選びます。
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


## 1.1.0：ローカル動画と AI チャット

コマンドパレットの **Open local video** でファイルを選ぶか、絶対パスを貼り付けます。Vault 外の動画も開けます。YouTube と共通の再生、一文ごとの字幕移動、二言語字幕、翻訳キャッシュ、ウィンドウ内全画面、スクリーンショット、ノートへの書き出しが使えます。

- 同名の `lesson.srt`、`lesson.en.srt`、`lesson.zh.vtt` を自動検出します。SRT/VTT に外部ツールは不要です。埋め込みテキスト字幕には **ffmpeg と ffprobe**、ASS/SSA には ffmpeg が必要です。**Subtitle track** で字幕を選びます。
- **Create transcript note** は原文と既存の訳文を一つの Markdown ページに保存します。タイムスタンプから動画の該当位置へ戻れます。元の動画を移動するとリンクの更新が必要です。
- 字幕がない場合、マイクボタンから設定済みの Groq/OpenAI Whisper で文字起こしできます。この操作は音声を送信します。動画を開くだけでは送信しません。画像字幕・焼き付け字幕はテキストとして抽出できません。再生には対応コーデック（例：H.264/AAC MP4、WebM）が必要です。

ローカル動画と YouTube の字幕パネル右上にある **AI help** をクリックします。**Summarize video**、**Explain this moment**、自由な質問と追加質問が使えます。回答の時刻をクリックして移動でき、**Save chat to note** で会話をノートに保存できます。

AI には字幕、再生位置、最近の会話と、選択した画像を渡します。画像は「現在のフレーム」「全体から六枚」「字幕のみ」から選べます。全フレームや音声全体を見る機能ではありません。長い字幕の要約は全字幕を分割処理し、通常の質問では関連する抜粋のみを使う場合があります。画像取得失敗や部分的な字幕利用は表示されます。過去の画像は次の質問へ再添付しません。

設定済みの AI バックエンドを使います。**Video chat Codex model** はチャット専用のモデル指定で、空欄なら翻訳モデルを引き継ぎます。自分のアカウントで利用可能なモデルを指定し、画像を送る場合は画像対応モデルを選んでください。Codex/Claude はログイン済みのローカル CLI、OpenAI/Anthropic は API キーを使います。質問を送ると証拠がそのサービスへ送信されます。**Stop** はチャットのみを停止します。送信済みの API リクエストはサーバー側で完了する場合があります。

履歴は動画ごとにローカル保存されます（最近 100 動画、各 200 メッセージ）。毎回最大 30 メッセージ、本文合計 24,000 文字までを再送します。古い会話の自動要約はありません。画像は履歴に保存しません。**Clear chat** はその動画の履歴を消去しますが、書き出したノートは残ります。設定と履歴を含む `data.json` は非公開で保管してください。
