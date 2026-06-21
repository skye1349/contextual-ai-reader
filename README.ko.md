# Contextual AI Reader 한국어

[English](https://github.com/skye1349/contextual-ai-reader/blob/main/README.md) · [中文](https://github.com/skye1349/contextual-ai-reader/blob/main/README.zh-CN.md) · [日本語](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ja.md) · [Español](https://github.com/skye1349/contextual-ai-reader/blob/main/README.es.md) · [Français](https://github.com/skye1349/contextual-ai-reader/blob/main/README.fr.md) · [Deutsch](https://github.com/skye1349/contextual-ai-reader/blob/main/README.de.md)

Contextual AI Reader는 Obsidian 데스크톱용 읽기 보조 플러그인입니다. 선택한 텍스트 번역, 문맥 기반 어휘 설명, 음성 읽기, 발췌 노트, PDF 선택 텍스트 번역, Markdown 파일 전체 번역을 지원합니다.

## 주요 기능

- 원문 언어를 직접 선택하거나 자동 감지할 수 있습니다.
- 번역과 어휘 설명에 사용할 학습/목표 언어를 선택할 수 있습니다.
- macOS에서는 `Command`, Windows/Linux에서는 `Ctrl`을 누른 상태로 텍스트를 선택하면 팝업이 나타납니다.
- 짧은 단어 또는 용어는 먼저 캐시와 빠른 번역을 사용하고, 필요하면 AI가 현재 문단의 문맥을 바탕으로 설명합니다.
- 목표 언어가 중국어이고 영어 단어를 선택한 경우 내장 영어-중국어 미니 사전도 사용됩니다.
- 현재 Markdown 파일의 번역을 원문 아래에 추가할 수 있습니다.
- 현재 Markdown 파일을 원문/번역 문단이 교차되는 대역 형식으로 만들 수 있습니다.
- 파일, 폴더, 와일드카드로 여러 Markdown 파일을 일괄 번역할 수 있습니다.
- AI 백엔드가 지원하면 token usage를 표시합니다.

## AI 백엔드

설정의 `AI backend`에서 선택합니다.

- `Auto`: 로컬 Codex를 먼저 사용하고, 없으면 Claude Code를 사용합니다.
- `Codex`: 로컬 Codex CLI와 로그인된 계정을 사용합니다.
- `Claude Code`: 로컬 Claude Code CLI와 로그인된 계정을 사용합니다.
- `OpenAI API token`: OpenAI API key를 사용합니다.
- `Anthropic API token`: Anthropic API key를 사용합니다.

## 기본 설정

- `Source language`: 읽고 있는 텍스트의 언어. 확실하지 않으면 `Auto detect`를 사용하세요.
- `Learning / target language`: 번역과 어휘 설명의 출력 언어.
- `Require Command/Ctrl key for auto translate`: 일반 텍스트 선택과 충돌하지 않도록 켜 두는 것을 권장합니다.
- `Custom prompt / context`: 책, 분야, 용어, 번역 스타일을 적습니다.
- `Reasoning effort`: 번역에는 보통 `none`이 빠르고 비용이 적습니다.

## 사용법

1. Markdown 노트 또는 선택 가능한 PDF를 엽니다.
2. macOS에서는 `Command`, Windows/Linux에서는 `Ctrl`을 누른 채 텍스트를 선택합니다.
3. 선택한 텍스트 근처에 팝업이 나타납니다.
4. Sparkles 버튼으로 AI 번역 또는 문맥 설명을 실행합니다.
5. Copy로 복사하거나 Book plus로 발췌 노트에 저장할 수 있습니다.

## Markdown 파일 번역

Command Palette에서 다음 명령을 실행합니다.

- `Translate current Markdown file: append target language below`
- `Translate current Markdown file: interleave target-language paragraphs`

일괄 번역 경로는 vault 기준 상대 경로입니다. 절대 경로는 사용하지 않습니다.

```text
Books/Example/
Books/Example/Chapter 1.md
Books/Example/*.md
Books/Example/**/*.md
```

## 개인정보

이 플러그인은 완전한 오프라인 번역기가 아닙니다. 선택한 백엔드에 따라 선택 텍스트와 Markdown 내용이 Codex, Claude Code, OpenAI API, Anthropic API로 전송될 수 있습니다. API key는 Obsidian 로컬 설정에 저장됩니다.

## License

MIT
