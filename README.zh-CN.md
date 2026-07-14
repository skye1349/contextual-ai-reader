# Contextual AI Reader 中文文档

[English](https://github.com/skye1349/contextual-ai-reader/blob/main/README.md) · [日本語](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ja.md) · [한국어](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ko.md) · [Español](https://github.com/skye1349/contextual-ai-reader/blob/main/README.es.md) · [Français](https://github.com/skye1349/contextual-ai-reader/blob/main/README.fr.md) · [Deutsch](https://github.com/skye1349/contextual-ai-reader/blob/main/README.de.md)

Contextual AI Reader 是一个 Obsidian 桌面端阅读辅助插件，支持 macOS、Windows 和 Linux。它可以在你阅读 Markdown、可选中文本的 PDF、外语书籍、长篇文章或 YouTube 字幕时，提供翻译、上下文生词解释、朗读、摘抄、生词本和整篇/批量翻译。

现在插件支持可配置语言方向：你可以选择当前阅读材料的语言，也可以让插件自动检测；然后选择你想学习/输出的目标语言。默认是自动检测原文语言，并翻译成简体中文。

插件支持两类 AI 调用方式：

- 本地账号模式：通过本机的 Codex 或 Claude Code CLI，使用你已经登录的 ChatGPT/Codex 或 Claude 账号。
- API Token 模式：在插件设置中填写 OpenAI 或 Anthropic API key 后直接调用 API。

默认模式是 `Auto`：优先使用本地 Codex，找不到 Codex 时再尝试 Claude Code。

## 功能概览

- 按住主修饰键选中文本后弹出翻译/解释窗口：macOS 使用 `Command`，Windows/Linux 使用 `Ctrl`。
- 选中短语、句子、段落时，先显示快速翻译，再可点击 Sparkles 用 AI 精修。
- 选中单个词或短词条时，先查本地缓存；如果目标语言是中文且原词是英文，会优先查内置英中词典；随后可以结合当前段落生成 AI 语境解释。
- 支持选择原文语言和目标语言，原文语言可以自动检测。
- 支持 Obsidian 中可选中文本的 PDF。
- 支持朗读选中文本。
- 支持把选中文本、生词解释、翻译结果保存到摘抄笔记。
- 支持翻译当前 Markdown 文件，并把目标语言译文整体追加到原文后面。
- 支持翻译当前 Markdown 文件，并把目标语言译文插入到对应原文段落下方，形成双语对照。
- 支持按文件、文件夹、通配符批量翻译多个 Markdown 文件。
- 长章节翻译时会合并连续短段落，减少 token 浪费。
- AI 调用结束后显示 token usage。
- 支持自定义阅读背景和翻译偏好，比如当前正在读哪本书、术语怎么翻译。
- 支持粘贴 YouTube 链接，在 Obsidian 标签页中打开语言学习播放器。
- 支持提取并合并成完整句子的字幕、逐句语境翻译、播放跟随高亮和点击字幕跳转。
- 支持只截取视频画面并写入 Markdown 笔记，同时插入可回跳播放器的时间戳。
- 支持把整份字幕、翻译和时间戳生成到新的 transcript note。

## AI 后端设置

打开插件设置，找到 `AI backend`。

可选模式：

- `Auto`：默认模式。优先使用本地 Codex，找不到时使用本地 Claude Code。
- `Codex`：使用本机 Codex 可执行文件和本地登录状态。
- `Claude Code`：使用本机 Claude Code 可执行文件和本地登录状态。
- `OpenAI API token`：使用你填写的 OpenAI API key。
- `Anthropic API token`：使用你填写的 Anthropic API key。

如果你只是想使用 ChatGPT/Codex 会员额度，通常保持 `Auto` 或选择 `Codex` 即可，不需要填写 API key。

## 推荐配置

建议先检查这些设置：

- `Source language`：当前阅读材料的语言；不确定就选 `Auto detect`。
- `Learning / target language`：你希望翻译和生词解释输出成什么语言。
- `Require Command/Ctrl key for auto translate`：建议开启。这样普通选中文本不会触发翻译。
- `Reasoning effort`：建议 `none`。翻译一般不需要高 reasoning，可以更快、更省。
- `Timeout`：长文翻译可以设置到 `300` 秒。
- `Single-shot translation limit`：默认 `60000` 字符。
- `Batch chunk size`：默认 `30000` 字符。

常用自定义项：

- `Custom prompt / context`：告诉 AI 你正在读什么、希望术语怎么处理。
- `Excerpt file`：设置摘抄/生词本保存到哪个 Markdown 文件。
- `Speech language`：系统朗读使用的语言标签，例如 `en-US`、`ja-JP`、`ko-KR`、`zh-CN`。
- `Speech rate`：默认 `0.92`。

Windows 使用本地 CLI 模式时，需要让 `codex.cmd` 或 `claude.cmd` 能在 PATH 中被找到，或者在插件设置里填写完整命令路径。如果使用 OpenAI/Anthropic API token 模式，则不需要安装本地 CLI。

## 自定义 Prompt 怎么写

`Custom prompt / context` 会影响：

- AI 精修翻译；
- 单词/短词条的上下文解释；
- 当前文件整篇翻译；
- 批量文件翻译。

它不会影响本地缓存或内置词典的即时释义。

示例：

```text
我正在阅读《穷查理宝典》。请结合投资、商业、心理学和芒格语境翻译。
中文要自然，不要机械直译。重要术语保持一致。
```

```text
我正在阅读一本交易心理学书。请保留关键交易术语。
edge 在交易优势语境下翻译为“优势”。
```

## 选中文本弹窗

默认情况下，普通选中文本不会触发插件。这是为了避免你在记笔记时频繁误触。

触发方式：

1. 打开 Markdown 笔记，或打开可以选中文本的 PDF。
2. 按住主修饰键：macOS 是 `Command`，Windows/Linux 是 `Ctrl`。
3. 不松开这个键，选中文本。
4. 松开鼠标或触控板。
5. 弹窗会出现在选中文本附近。

如果你关闭 `Require Command/Ctrl key for auto translate`，那么普通选中文本后也会弹窗。但如果你经常编辑笔记，不建议关闭。

## 弹窗按钮含义

- Speaker：朗读原文。
- Sparkles：使用当前配置的 AI 后端进行精修翻译或上下文解释。
- Book plus：保存到摘抄/生词本文件。
- Copy：复制当前翻译或生词解释。
- Stop：停止正在运行的 AI 请求；使用 Codex 或 Claude Code 时会尝试杀掉本地 CLI 进程。

## 段落、句子、短语翻译

当你选中一句话、一段话或一个短语：

1. macOS 按住 `Command`，Windows/Linux 按住 `Ctrl`，并选中文本。
2. 插件会先给出一个快速翻译。
3. 如果你想要更高质量的 AI 翻译，点击 Sparkles。
4. 如果结果有用，可以点击 Copy 复制，或点击 Book plus 保存到摘抄。

快速翻译的目标是“马上看懂”。Sparkles 才会使用你配置的 AI 后端、模型、custom prompt 和 token budget。

## 单词/短词条解释

当你只选中一个单词或很短的词条：

1. macOS 按住 `Command`，Windows/Linux 按住 `Ctrl`，并选中这个词。
2. 插件会先查本地缓存。
3. 如果目标语言是中文且原词是英文，会先查内置英中小词典。
4. 如果没有命中，插件会先用快速翻译给一个基础释义。
5. 插件随后会读取当前段落，用 AI 解释这个词在当前语境下到底是什么意思。
6. 你可以点击 Book plus 保存到生词本/摘抄文件。

单词解释不是普通词典翻译。它重点回答的是：这个词在当前段落、当前书、当前语境里应该怎么理解。

## 命令面板中的选区命令

打开 Obsidian Command Palette 后可以使用：

- `Translate selection to target language`：把选中文本替换为目标语言译文。
- `Append target-language translation below selection`：保留原文，并把目标语言译文插到原文下方。
- `Speak selected text`：朗读选中文本。
- `Save selection to excerpts`：保存选中文本到摘抄文件。

## 翻译当前 Markdown 文件

打开一个 Markdown 文件后，在 Command Palette 里运行：

- `Translate current Markdown file: append target language below`
- `Translate current Markdown file: interleave target-language paragraphs`

### append target language below

这个模式会把整篇目标语言译文追加到当前文件末尾。

```text
整篇原文

整篇目标语言译文
```

适合你想保留原文，并在后面放一整份译文的情况。

### interleave target-language paragraphs

这个模式会把译文插入到对应原文段落下方，形成双语对照。

```text
原文段落 1

译文段落 1

原文段落 2

译文段落 2
```

适合逐段阅读、精读和做双语对照。

注意：如果原文来自 EPUB/OCR，可能会被切成大量很短的小段。插件会自动把连续短正文段落合并成更大的 translation unit 再发给 AI，以减少 token 消耗。原文不会被改乱，但译文可能会插在一小组相关原文段落之后，而不是每一个碎段下面都插一句。

同一时间只能运行一个整篇或批量翻译任务。如果你已经有一个任务在跑，再启动第二个任务，插件会提示你先 Stop 当前任务。

## 批量翻译多个 Markdown 文件

适合一次性翻译多个章节。

1. 打开 Command Palette。
2. 运行：
   - `Batch translate Markdown files: append target language below`
   - `Batch translate Markdown files: interleave target-language paragraphs`
3. 在弹出的窗口中，每行输入一个文件、文件夹或通配符。
4. 点击 Start。

批量翻译会直接修改匹配到的 Markdown 文件。重要笔记请先备份。

## 批量路径怎么写

路径必须是 vault-relative，也就是相对于 Obsidian vault 根目录的路径。

正确写法：

```text
Books/Trading in the Zone/
Books/Trading in the Zone/08 - Chapter 1.md
Books/Trading in the Zone/*.md
Books/Trading in the Zone/1? - *.md
Books/Trading in the Zone/**/*.md
```

错误写法：

```text
/Users/me/Documents/Vault/Books/Trading in the Zone/
```

支持的范围：

- 单个 Markdown 文件：`Books/Example/Chapter 1.md`
- 文件夹：`Books/Example/`
- 简单通配符：`Books/Example/*.md`
- 递归通配符：`Books/Example/**/*.md`
- 单字符通配符：`Books/Example/1? - *.md`

如果输入文件夹，插件会递归匹配这个文件夹下所有 Markdown 文件。

## 摘抄和生词本

在设置中配置 `Excerpt file`。点击 Book plus，或运行 `Save selection to excerpts`，插件会把内容追加到这个文件。

摘抄条目可以包含原文、弹窗翻译、单词解释、来源文件和行号引用。

生词条目仍然保存在同一个主生词本里，但每个生词卡片会带可复用的 inline metadata：

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

这样不需要一开始拆很多文件，也可以用 Obsidian 搜索、tag 或 Dataview 按语言、状态、来源笔记、主题来过滤。

## Token Usage 怎么看

当 AI 后端返回 token usage 时，插件会显示类似：

```text
input ↑ output ↓ (total, cached)
```

长文翻译时，进度窗口还会显示已运行时间、batch 进度、translation units 进度、原文段落进度、当前 token usage 和 Stop 按钮。

## YouTube 语言学习播放器（开发预览）

在 Command Palette 中运行 `Open YouTube learning player`，然后粘贴 `youtube.com` 或 `youtu.be` 链接。插件会在 Obsidian 标签页中打开视频，并在旁边显示逐句字幕。自动字幕中很短、还没说完的碎片会先合并成更适合阅读的完整句子。

播放视频时，右侧会自动高亮当前说到的句子并滚动到对应位置。点击任意字幕或时间戳，已经打开的播放器会直接跳到那一秒，不会重新打开一个窗口。

播放器工具栏包含：

- Play / Pause：播放或暂停当前视频。
- Camera：只截取播放器中的视频区域，保存到设置里的 `YouTube screenshot folder`，并把图片和可点击时间戳插入最近使用的 Markdown 笔记。
- File text：把当前字幕、翻译和时间戳生成到 `YouTube transcript folder`。
- Languages：使用当前 AI 后端按连续字幕上下文批量翻译。
- Stop：真正停止正在运行的 AI 字幕翻译，并终止本地 Codex/Claude CLI 进程。
- External link：在 YouTube 网站打开当前视频和时间位置。

字幕提取会先尝试不依赖额外程序的方式。由于 YouTube 越来越多字幕地址带有动态签名，一些视频需要安装 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 才能稳定读取。安装后可让 `yt-dlp command` 保持为空自动检测，也可以在设置中填写完整路径。插件只使用它解析视频元数据和字幕 URL，不会下载整段视频。

如果视频作者关闭了“允许在其他网站播放”，插件无法绕过 YouTube 的限制。此时可以点 External link 去 YouTube 观看；字幕提取和 transcript note 仍可能可用。

## 隐私和安全

这个插件不是离线翻译。根据你选择的后端，选中文本或 Markdown 内容可能会发送到本地 Codex CLI/App、本地 Claude Code、OpenAI API 或 Anthropic API。

API key 会保存在插件的本地 Obsidian 设置数据中。不要把 vault 里的 `.obsidian/plugins/.../data.json` 上传到公开仓库。

整篇翻译和批量翻译会直接修改 Markdown 文件。重要资料请先备份。

## 常见问题

### 为什么必须按 Command/Ctrl 才弹窗？

因为 Obsidian 是笔记软件，普通选中文本是高频操作。默认要求按住主修饰键是为了避免频繁误触。

### 为什么我选中单词时不是普通整句翻译？

插件会把单个词或短词条识别成生词模式。它会先给基础释义，再结合当前段落解释这个词在语境中的含义。

### 为什么双语对照不是每个很短的小段下面都有译文？

为了降低 token 消耗，插件会合并连续短正文段落后再翻译。原文不变，译文会插到相关短段落组后面。

### 批量路径为什么不能写绝对路径？

为了配合 Obsidian vault API，批量路径使用 vault-relative 路径。也就是说，从你的 vault 根目录开始写。

## 开发

```bash
npm install
npm run build
```

如果要在单独的测试 Vault 中安装一个可以与 Marketplace 正式版区分开的开发版：

```bash
npm run build:dev-plugin
```

把生成的 `dist-dev/contextual-ai-reader-dev` 文件夹放进测试 Vault 的 `.obsidian/plugins/`。开发版使用独立 ID `contextual-ai-reader-dev`，显示名称是 `Contextual AI Reader Dev`。这个命令不会修改正式版本号、不会打 tag、也不会发布 release。

也可以在创建好测试 Vault 后，用一条命令完成构建和安装：

```bash
npm run install:dev-plugin -- "/测试 Vault 的绝对路径"
```

## License

MIT
