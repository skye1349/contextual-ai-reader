# Contextual AI Reader auf Deutsch

[English](https://github.com/skye1349/contextual-ai-reader/blob/main/README.md) · [中文](https://github.com/skye1349/contextual-ai-reader/blob/main/README.zh-CN.md) · [日本語](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ja.md) · [한국어](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ko.md) · [Español](https://github.com/skye1349/contextual-ai-reader/blob/main/README.es.md) · [Français](https://github.com/skye1349/contextual-ai-reader/blob/main/README.fr.md)

Contextual AI Reader ist ein Obsidian-Desktop-Plugin zum unterstützten Lesen: Übersetzung, kontextbezogene Worterklärungen, Vorlesen, Exzerpte, auswählbare PDFs und Übersetzung von Markdown-Dateien.

## Systemanforderungen und Installation

Verwende Obsidian Desktop unter macOS, Windows oder Linux. Mobil können synchronisierte Notizen gelesen werden, lokale CLI- und Videowerkzeuge laufen dort jedoch nicht. Community Plugins benötigt weder Node.js noch npm oder das Quellcode-Repository. Wähle ein KI-Backend:

- Codex: Installiere [Codex App oder CLI](https://developers.openai.com/codex/cli) und führe für die CLI `codex login` aus.
- Claude Code: Installiere Claude Code und melde dich an.
- API: Hinterlege einen OpenAI- oder Anthropic-API-Key; eine lokale CLI ist nicht erforderlich.

Geschützte YouTube-Untertitel, saubere Video-Einzelbilder und Transkription ohne CC benötigen zusätzliche Werkzeuge.

| System | `yt-dlp` und `ffmpeg` installieren |
| --- | --- |
| macOS | `brew install yt-dlp ffmpeg` |
| Windows | `winget install yt-dlp.yt-dlp` und `winget install Gyan.FFmpeg` |
| Ubuntu/Debian | `sudo apt update && sudo apt install yt-dlp ffmpeg` |
| Anderes Linux | Paketmanager der Distribution verwenden |

Starte Obsidian danach neu. Falls die automatische Erkennung fehlschlägt, trage den vollständigen Pfad zur ausführbaren Datei in den Einstellungen ein. Transkription ohne CC benötigt zusätzlich einen Groq- oder OpenAI-API-Key.

## Lokale Daten und Cache

Einstellungen, API-Keys, Vokabelcache, YouTube-Untertitel und Übersetzungen werden pro Vault in `<vault>/.obsidian/plugins/contextual-ai-reader/data.json` gespeichert. Lösche `data.json`, den Plugin-Ordner oder die Plugin-Daten nicht, wenn der Cache erhalten bleiben soll. Kopiere die Datei beim Wechsel des Vaults privat.

Der Cache behält die 30 zuletzt verwendeten Videos. Screenshots und erzeugte Transkript-Notizen sind normale Vault-Dateien und werden beim Leeren des Caches nicht gelöscht. `data.json` kann API-Keys enthalten und darf nicht veröffentlicht, geteilt oder in Git eingecheckt werden.

## Funktionen

- Quellsprache wählen oder automatisch erkennen lassen.
- Lern-/Zielsprache für Übersetzungen und Worterklärungen wählen.
- Popup anzeigen, wenn Text mit gedrückter Taste ausgewählt wird: `Command` auf macOS, `Ctrl` auf Windows/Linux.
- Für einzelne Wörter oder kurze Begriffe zuerst Cache und Schnellübersetzung nutzen; danach kann KI die Bedeutung im aktuellen Absatz erklären.
- Wenn die Zielsprache Chinesisch ist und ein englisches Wort ausgewählt wird, wird zusätzlich ein kleines lokales Englisch-Chinesisch-Wörterbuch genutzt.
- Aktuelle Markdown-Datei übersetzen und die Übersetzung unter dem Original anhängen.
- Aktuelle Markdown-Datei als zweisprachige, verschachtelte Absätze übersetzen.
- Mehrere Markdown-Dateien per Pfad, Ordner oder Wildcard übersetzen.
- Token usage anzeigen, wenn das KI-Backend diese Daten liefert.

## KI-Backends

Wähle `AI backend` in den Einstellungen.

- `Auto`: zuerst lokales Codex, danach Claude Code.
- `Codex`: lokales Codex CLI und lokale Anmeldung.
- `Claude Code`: lokales Claude Code CLI und lokale Anmeldung.
- `OpenAI API token`: OpenAI API key.
- `Anthropic API token`: Anthropic API key.

## Grundeinstellungen

- `Source language`: Sprache des gelesenen Textes. Bei Unsicherheit `Auto detect`.
- `Learning / target language`: Ausgabesprache für Übersetzung und Worterklärung.
- `Require Command/Ctrl key for auto translate`: empfohlen, um versehentliche Popups zu vermeiden.
- `Custom prompt / context`: Buch, Fachgebiet, Terminologie und Stilwünsche.
- `Reasoning effort`: Für Übersetzung ist `none` meistens schneller und günstiger.

## Nutzung

1. Öffne eine Markdown-Notiz oder ein PDF mit auswählbarem Text.
2. Halte `Command` auf macOS oder `Ctrl` auf Windows/Linux gedrückt und wähle Text aus.
3. Das Popup erscheint neben der Auswahl.
4. Sparkles startet KI-Übersetzung oder kontextbezogene Erklärung.
5. Copy kopiert das Ergebnis, Book plus speichert es in der Exzerptnotiz.

## Markdown-Übersetzung

Verfügbare Befehle:

- `Translate current Markdown file and append translation`
- `Translate current Markdown file with interleaved translation`

Batch-Pfade sind relativ zum Vault, nicht absolute Dateisystempfade.

```text
Books/Example/
Books/Example/Chapter 1.md
Books/Example/*.md
Books/Example/**/*.md
```

## Datenschutz

Dieses Plugin ist keine reine Offline-Übersetzung. Je nach Backend können ausgewählter Text oder Markdown-Inhalte an Codex, Claude Code, OpenAI API oder Anthropic API gesendet werden. API keys werden lokal in den Obsidian-Einstellungen gespeichert.

## License

MIT
