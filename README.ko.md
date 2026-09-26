# Read and Watch with AI 한국어

[English](https://github.com/skye1349/contextual-ai-reader/blob/main/README.md) · [中文](https://github.com/skye1349/contextual-ai-reader/blob/main/README.zh-CN.md) · [日本語](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ja.md) · [Español](https://github.com/skye1349/contextual-ai-reader/blob/main/README.es.md) · [Français](https://github.com/skye1349/contextual-ai-reader/blob/main/README.fr.md) · [Deutsch](https://github.com/skye1349/contextual-ai-reader/blob/main/README.de.md)

## 1.2.0: 새 이름과 API 설정

**Contextual AI Reader**의 새 이름은 **Read and Watch with AI**입니다. 내부 ID와 저장소 주소는 유지하여 설정, 자막 캐시, 대화 기록을 계속 사용할 수 있습니다. 기존 출력 경로는 유지하고 신규 설치는 새 이름을 사용합니다.

**AI backend**에서 **OpenAI-compatible API** 또는 **Anthropic API token**을 선택하고 해당 서비스의 키, 기본 URL, 모델 ID를 입력하세요. OpenAI는 `https://api.openai.com/v1`, Claude는 `https://api.anthropic.com/v1`입니다. Codex, Claude Code, Node.js, CLI 구독 없이 선택 영역/PDF 텍스트 번역, 어휘 설명, 전체 노트·일괄 번역, 자막 번역, 영상 요약, 후속 질문, 이미지 질문을 사용할 수 있습니다. 이미지에는 시각 입력 지원 모델이 필요합니다. **Test text / Test image**는 간단한 연결 테스트를 보내며 합성 이미지를 사용합니다. 서비스 요금이 발생할 수 있습니다.

**Auto**는 OpenAI 호환 키, Anthropic 키, 로컬 CLI 순으로 선택합니다. 키가 있어도 로컬 로그인을 사용하려면 **Codex**를 직접 선택하세요. 자막 없는 음성은 **Transcription API key / base URL / model** 또는 Groq를 별도로 설정합니다. `/audio/transcriptions`, `verbose_json`, 타임스탬프 구간을 지원하는 서비스가 필요합니다. 두 기본 URL이 같을 때만 채팅 키를 재사용합니다. Claude 키로 OpenAI Whisper를 호출할 수 없습니다. 임의의 키나 모델이 모든 기능을 지원하는 것은 아닙니다. CC 추출, 스크린샷, 시스템 읽어주기는 AI 키가 필요 없습니다.

Read and Watch with AI는 Obsidian 데스크톱용 읽기 보조 플러그인입니다. 선택한 텍스트 번역, 문맥 기반 어휘 설명, 음성 읽기, 발췌 노트, PDF 선택 텍스트 번역, Markdown 파일 전체 번역을 지원합니다.

## 시스템 요구 사항 및 설치

macOS, Windows 또는 Linux용 Obsidian 데스크톱을 사용하세요. 모바일에서는 동기화된 노트를 읽을 수 있지만 로컬 CLI와 비디오 도구를 실행할 수 없습니다. Community Plugins 설치에는 Node.js, npm 또는 소스 저장소가 필요하지 않습니다. 다음 AI 백엔드 중 하나를 선택하세요.

- Codex: [Codex App 또는 CLI](https://developers.openai.com/codex/cli)를 설치하고 CLI에서는 `codex login`을 실행합니다.
- Claude Code: Claude Code를 설치하고 로그인합니다.
- API: OpenAI 또는 Anthropic API key를 설정합니다. 로컬 AI CLI가 필요하지 않습니다.

보호된 YouTube 자막, 깨끗한 비디오 프레임 저장, CC가 없는 영상의 음성 인식에는 추가 도구가 필요합니다.

| 운영체제 | `yt-dlp` 및 `ffmpeg` 설치 |
| --- | --- |
| macOS | `brew install yt-dlp ffmpeg` |
| Windows | `winget install yt-dlp.yt-dlp` 및 `winget install Gyan.FFmpeg` |
| Ubuntu/Debian | `sudo apt update && sudo apt install yt-dlp ffmpeg` |
| 기타 Linux | 배포판 패키지 관리자를 사용 |

설치 후 Obsidian을 다시 시작하세요. 자동 감지가 실패하면 설정에 실행 파일의 전체 경로를 입력하세요. CC 없는 영상의 음성 인식에는 Groq 또는 OpenAI API key도 필요합니다.

## 로컬 데이터 및 캐시

설정, API key, 단어 캐시, YouTube 자막과 번역은 Vault별 `<vault>/.obsidian/plugins/contextual-ai-reader/data.json`에 저장됩니다. 캐시를 유지하려면 `data.json`, 플러그인 폴더 또는 플러그인 데이터를 삭제하지 마세요. Vault를 바꿀 때는 이 파일을 비공개로 복사하세요.

YouTube 캐시는 최근 30개 영상을 보관합니다. 스크린샷과 생성된 transcript note는 일반 Vault 파일이므로 캐시 삭제의 영향을 받지 않습니다. `data.json`에는 API key가 포함될 수 있으므로 공개, 공유 또는 Git commit을 하면 안 됩니다.

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

- `Auto`: OpenAI 호환 키, Anthropic 키, 로컬 CLI 순으로 선택합니다.
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

- `Translate current Markdown file and append translation`
- `Translate current Markdown file with interleaved translation`

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


## 1.1.0: 로컬 동영상과 AI 채팅

명령 팔레트의 **Open local video**에서 파일을 선택하거나 절대 경로를 붙여 넣으세요. 보관함 밖의 파일도 열 수 있습니다. YouTube와 같은 재생, 문장별 자막 이동, 이중 언어 자막, 번역 캐시, 창 안 전체 화면, 스크린샷, 노트 내보내기를 제공합니다.

- `lesson.srt`, `lesson.en.srt`, `lesson.zh.vtt`처럼 이름이 일치하는 자막을 자동으로 찾습니다. SRT/VTT에는 별도 도구가 필요 없습니다. 내장 텍스트 자막에는 **ffmpeg와 ffprobe**, ASS/SSA에는 ffmpeg가 필요합니다. **Subtitle track**에서 자막을 선택하세요.
- **Create transcript note**는 원문과 기존 번역을 하나의 Markdown 페이지로 저장합니다. 타임스탬프를 누르면 영상의 해당 위치로 돌아갑니다. 원본 파일을 이동하면 링크를 갱신해야 합니다.
- 자막이 없으면 마이크 버튼으로 설정된 Groq/OpenAI Whisper를 이용해 음성을 텍스트로 변환할 수 있습니다. 이 작업은 음성을 전송하지만, 영상을 여는 것만으로는 전송하지 않습니다. 이미지 자막이나 화면에 입혀진 자막은 텍스트로 추출하지 못합니다. 재생은 코덱 지원에 따라 달라집니다(H.264/AAC MP4, WebM 권장).

로컬 또는 YouTube 영상의 자막 패널 오른쪽 위 **AI help**를 누르세요. **Summarize video**, **Explain this moment**, 직접 질문과 후속 질문을 지원합니다. 답변의 시간 표시로 이동하고 **Save chat to note**로 대화를 노트에 저장할 수 있습니다.

AI에는 자막, 재생 위치, 최근 대화와 선택한 화면을 전달합니다. 현재 프레임, 전체 구간에서 추출한 여섯 프레임, 자막만 사용 중 하나를 선택합니다. 영상 전체를 프레임마다 보거나 음성을 직접 듣는 기능은 아닙니다. 긴 자막의 요약은 전체 자막을 나눠 처리하며, 일반 질문은 관련 발췌문만 사용할 수 있습니다. 추출 실패와 부분적인 자막 사용은 표시됩니다. 이전 이미지가 다음 요청에 다시 첨부되지는 않습니다.

기존 AI 백엔드를 사용합니다. **Video chat Codex model**은 채팅 모델만 따로 지정하며, 비워 두면 번역 모델을 사용합니다. 계정에서 이용 가능한 모델을 선택하고 이미지 질문에는 시각 입력 지원 모델을 사용하세요. Codex/Claude는 로컬 CLI 로그인, OpenAI/Anthropic은 API 키를 사용합니다. 질문 전송 시 해당 서비스에 자막과 이미지를 보냅니다. **Stop**은 채팅만 중단합니다. 이미 전송된 API 요청은 서버에서 계속 처리될 수 있습니다.

대화는 영상별로 로컬에 저장합니다(최근 100개 영상, 각 200개 메시지). 요청마다 최근 최대 30개 메시지와 본문 합계 24,000자까지 다시 보냅니다. 오래된 대화의 자동 요약은 없습니다. 이미지는 기록에 저장하지 않습니다. **Clear chat**은 해당 영상의 기록만 지우며, 내보낸 노트는 남습니다. 설정과 기록이 담긴 `data.json`은 비공개로 보관하세요.
