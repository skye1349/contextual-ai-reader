# Contextual AI Reader auf Deutsch

[English](https://github.com/skye1349/contextual-ai-reader/blob/main/README.md) · [中文](https://github.com/skye1349/contextual-ai-reader/blob/main/README.zh-CN.md) · [日本語](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ja.md) · [한국어](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ko.md) · [Español](https://github.com/skye1349/contextual-ai-reader/blob/main/README.es.md) · [Français](https://github.com/skye1349/contextual-ai-reader/blob/main/README.fr.md)

Contextual AI Reader ist ein Obsidian-Desktop-Plugin zum unterstützten Lesen: Übersetzung, kontextbezogene Worterklärungen, Vorlesen, Exzerpte, auswählbare PDFs und Übersetzung von Markdown-Dateien.

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

- `Translate current Markdown file: append target language below`
- `Translate current Markdown file: interleave target-language paragraphs`

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
