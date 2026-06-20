# Contextual AI Reader 中文文档

Contextual AI Reader 是一个面向中文读者的 Obsidian 桌面端阅读辅助插件。它可以在你阅读英文 Markdown、可选中文本的 PDF、英文书籍或长篇文章时，提供中文翻译、上下文生词解释、朗读、摘抄、生词本和整篇/批量翻译。

插件支持两类 AI 调用方式：

- 本地账号模式：通过本机的 Codex 或 Claude Code CLI，使用你已经登录的 ChatGPT/Codex 或 Claude 账号。
- API Token 模式：在插件设置中填写 OpenAI 或 Anthropic API key 后直接调用 API。

默认模式是 `Auto`：优先使用本地 Codex，找不到 Codex 时再尝试 Claude Code。

## 功能概览

- 按住 `Command` 选中文本后弹出翻译/解释窗口。
- 选中短语、句子、段落时，先显示快速中文翻译，再可点击 Sparkles 用 AI 精修。
- 选中单个英文单词时，先查本地词典和缓存，再结合当前段落生成 AI 语境解释。
- 支持 Obsidian 中可选中文本的 PDF。
- 支持英文朗读。
- 支持把选中文本、生词解释、翻译结果保存到摘抄笔记。
- 支持翻译当前 Markdown 文件，并把中文整体追加到英文后面。
- 支持翻译当前 Markdown 文件，并把中文插入到对应英文段落下方，形成中英对照。
- 支持按文件、文件夹、通配符批量翻译多个 Markdown 文件。
- 长章节翻译时会合并连续短段落，减少 token 浪费。
- AI 调用结束后显示 token usage。
- 支持自定义阅读背景和翻译偏好，比如当前正在读哪本书、术语怎么翻译。

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

建议保留这些默认设置：

- `Require Command key for auto translate`：开启。这样普通选中文本不会触发翻译。
- `Reasoning effort`：`none`。翻译一般不需要高 reasoning，可以更快、更省。
- `Timeout`：长文翻译可以设置到 `300` 秒。
- `Single-shot translation limit`：默认 `60000` 字符。
- `Batch chunk size`：默认 `30000` 字符。

常用自定义项：

- `Custom prompt / context`：告诉 AI 你正在读什么、希望术语怎么处理。
- `Excerpt file`：设置摘抄/生词本保存到哪个 Markdown 文件。
- `Speech language`：默认 `en-US`。
- `Speech rate`：默认 `0.92`。

## 自定义 Prompt 怎么写

`Custom prompt / context` 会影响：

- AI 精修翻译；
- 单词的上下文解释；
- 当前文件整篇翻译；
- 批量文件翻译。

它不会影响本地词典/缓存的即时释义。

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
2. 按住 macOS 的 `Command` 键。
3. 不松开 `Command`，选中英文文本。
4. 松开鼠标或触控板。
5. 弹窗会出现在选中文本附近。

如果你关闭 `Require Command key for auto translate`，那么普通选中文本后也会弹窗。但如果你经常编辑笔记，不建议关闭。

## 弹窗按钮含义

不同状态下，弹窗会显示不同按钮：

- Speaker：朗读原始英文。
- Sparkles：使用当前配置的 AI 后端进行精修翻译或上下文解释。
- Book plus：保存到摘抄/生词本文件。
- Copy：复制当前翻译或生词解释。
- Stop：停止正在运行的 AI 请求；使用 Codex 或 Claude Code 时会尝试杀掉本地 CLI 进程。

## 段落、句子、短语翻译

当你选中一句话、一段话或一个短语：

1. 按住 `Command` 并选中文本。
2. 插件会先给出一个快速中文翻译。
3. 如果你想要更高质量的 AI 翻译，点击 Sparkles。
4. 如果结果有用，可以点击 Copy 复制，或点击 Book plus 保存到摘抄。

快速翻译的目标是“马上看懂”。Sparkles 才会使用你配置的 AI 后端、模型、custom prompt 和 token budget。

## 单词解释

当你只选中一个英文单词：

1. 按住 `Command` 并选中这个词。
2. 插件会先查本地词典和本地缓存。
3. 如果命中，会立刻显示基础释义。
4. 插件随后会读取当前段落，用 AI 解释这个词在当前语境下到底是什么意思。
5. 你可以点击 Book plus 保存到生词本/摘抄文件。

单词解释不是普通词典翻译。它重点回答的是：这个词在当前段落、当前书、当前语境里应该怎么理解。

## 命令面板中的选区命令

打开 Obsidian Command Palette 后可以使用：

- `Translate selection to Chinese`：把选中文本替换为中文。
- `Append Chinese translation below selection`：保留原文，并把中文插到原文下方。
- `Speak selected English text`：朗读选中的英文。
- `Save selection to excerpts`：保存选中文本到摘抄文件。

## 翻译当前 Markdown 文件

打开一个 Markdown 文件后，在 Command Palette 里运行：

- `Translate current Markdown file: append Chinese below`
- `Translate current Markdown file: interleave Chinese paragraphs`

### append Chinese below

这个模式会把整篇中文翻译追加到当前文件末尾。

结构类似：

```text
整篇英文原文

整篇中文翻译
```

适合你想保留英文原文，并在后面放一整份中文译文的情况。

### interleave Chinese paragraphs

这个模式会把中文插入到对应英文段落下方，形成中英对照。

结构类似：

```text
英文段落 1

中文段落 1

英文段落 2

中文段落 2
```

适合逐段阅读、精读和做中英对照。

注意：如果原文来自 EPUB/OCR，可能会被切成大量很短的小段。插件会自动把连续短正文段落合并成更大的 translation unit 再发给 AI，以减少 token 消耗。英文原文不会被改乱，但中文译文可能会插在一小组相关英文段落之后，而不是每一个碎段下面都插一句。

同一时间只能运行一个整篇或批量翻译任务。如果你已经有一个任务在跑，再启动第二个任务，插件会提示你先 Stop 当前任务。

## 批量翻译多个 Markdown 文件

适合一次性翻译多个章节。

操作步骤：

1. 打开 Command Palette。
2. 运行：
   - `Batch translate Markdown files: append Chinese below`
   - 或 `Batch translate Markdown files: interleave Chinese paragraphs`
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

在设置中配置 `Excerpt file`。

点击 Book plus，或运行 `Save selection to excerpts`，插件会把内容追加到这个文件。

摘抄条目可以包含：

- 原始英文；
- 弹窗翻译；
- 单词解释；
- 来源文件；
- 行号引用。

如果开启 `Open excerpt file after saving`，保存后会在侧边打开摘抄文件。

## 英文朗读

你可以用 Speaker 按钮，或运行 `Speak selected English text`。

相关设置：

- `Speech language`：默认 `en-US`。
- `Speech rate`：默认 `0.92`。

朗读使用 Obsidian 桌面环境能访问到的系统语音。

## Token Usage 怎么看

当 AI 后端返回 token usage 时，插件会显示类似：

```text
input ↑ output ↓ (total, cached)
```

含义：

- `input`：发给模型的输入 token。
- `output`：模型生成的输出 token。
- `total`：输入加输出。
- `cached`：后端报告的缓存输入 token，通常成本和速度压力低于普通 input，但仍说明有上下文被重复利用。

长文翻译时，进度窗口还会显示：

- 已运行时间；
- batch 进度；
- translation units 进度；
- 原文段落进度；
- 当前 token usage；
- Stop 按钮。

## 隐私和安全

这个插件不是离线翻译。

根据你选择的后端，选中文本或 Markdown 内容可能会发送到：

- 本地 Codex CLI/App，并通过你的本地 Codex/ChatGPT 登录状态调用；
- 本地 Claude Code，并通过你的本地 Claude 登录状态调用；
- OpenAI API；
- Anthropic API。

API key 会保存在插件的本地 Obsidian 设置数据中。不要把 vault 里的 `.obsidian/plugins/.../data.json` 上传到公开仓库。

整篇翻译和批量翻译会直接修改 Markdown 文件。重要资料请先备份。

## 常见问题

### 为什么必须按 Command 才弹窗？

因为 Obsidian 是笔记软件，普通选中文本是高频操作。默认要求按住 `Command` 是为了避免频繁误触。

### 为什么我选中单词时不是普通整句翻译？

插件会把单个英文词识别成生词模式。它会先给基础释义，再结合当前段落解释这个词在语境中的含义。

### 为什么中英对照不是每个很短的小段下面都有中文？

为了降低 token 消耗，插件会合并连续短正文段落后再翻译。英文原文不变，中文会插到相关短段落组后面。

### 批量路径为什么不能写绝对路径？

为了配合 Obsidian vault API，批量路径使用 vault-relative 路径。也就是说，从你的 vault 根目录开始写。

### 我可以同时跑两个整篇翻译吗？

不可以。插件只允许一个整篇或批量翻译任务同时运行，避免进度窗口重叠、Stop 杀错进程、token usage 串台。

## 开发与发布

安装依赖：

```bash
npm install
```

构建：

```bash
npm run build
```

发布时：

1. 更新 `manifest.json` 和 `versions.json`。
2. 运行 `npm run build`。
3. 提交源码和构建产物。
4. 推送 `main`。
5. 推送与 `manifest.json` 版本完全一致的 tag，例如 `1.0.3`。
6. GitHub Actions 会自动创建 release、上传资产并生成 artifact attestations。

## License

MIT
