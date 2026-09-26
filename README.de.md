# Read and Watch with AI auf Deutsch

[English](https://github.com/skye1349/contextual-ai-reader/blob/main/README.md) · [中文](https://github.com/skye1349/contextual-ai-reader/blob/main/README.zh-CN.md) · [日本語](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ja.md) · [한국어](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ko.md) · [Español](https://github.com/skye1349/contextual-ai-reader/blob/main/README.es.md) · [Français](https://github.com/skye1349/contextual-ai-reader/blob/main/README.fr.md)

## 1.2.0: neuer Name und API-Einrichtung

**Contextual AI Reader** heißt jetzt **Read and Watch with AI**. Interne ID und Repository-Adresse bleiben erhalten, ebenso Einstellungen, Caches und Chatverläufe. Bestehende Ausgabepfade bleiben unverändert; neue Installationen verwenden den neuen Namen.

Wähle unter **AI backend** entweder **OpenAI-compatible API** oder **Anthropic API token** und trage den passenden Schlüssel, die Basis-URL und die Modell-ID ein. OpenAI: `https://api.openai.com/v1`; Claude: `https://api.anthropic.com/v1`. Codex, Claude Code, Node.js oder ein CLI-Abonnement sind nicht erforderlich. Unterstützt werden Auswahl/PDF-Text, Worterklärungen, ganze Notizen und Stapel, Untertitel, Videozusammenfassungen, Rückfragen und Bildfragen. Für Bilder ist ein Modell mit Bildunterstützung nötig. **Test text / Test image** senden kleine Tests mit einem synthetischen Bild; Gebühren können anfallen.

**Auto** bevorzugt einen OpenAI-kompatiblen Schlüssel, dann Anthropic und schließlich lokale CLIs. Wähle **Codex** ausdrücklich für die lokale Anmeldung. Audio ohne Untertitel benötigt separat **Transcription API key / base URL / model** oder Groq. Der Dienst muss `/audio/transcriptions`, `verbose_json` und Zeitabschnitte unterstützen. Nur bei gleicher Basis-URL wird der Chatschlüssel wiederverwendet. Ein Claude-Schlüssel funktioniert nicht mit OpenAI Whisper. Schlüssel, Protokolle und Modellfähigkeiten sind nicht beliebig austauschbar. CC-Extraktion, Screenshots und Systemvorlesen benötigen keinen KI-Schlüssel.

Read and Watch with AI ist ein Obsidian-Desktop-Plugin zum unterstützten Lesen: Übersetzung, kontextbezogene Worterklärungen, Vorlesen, Exzerpte, auswählbare PDFs und Übersetzung von Markdown-Dateien.

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

- `Auto`: zuerst OpenAI-/Anthropic-Schlüssel, danach lokale CLIs.
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


## Neu in 1.1.0: lokale Videos und KI-Chat

Wähle **Open local video** in der Befehlspalette und öffne eine Datei oder füge ihren absoluten Pfad ein. Videos dürfen außerhalb des Vaults liegen. Wie bei YouTube stehen Wiedergabe, Navigation nach Untertitelsätzen, zweisprachige Untertitel, Übersetzungscache, Vollbild im Fenster, Screenshots und Notizexport zur Verfügung.

- Passende Dateien wie `lesson.srt`, `lesson.en.srt` und `lesson.zh.vtt` werden automatisch erkannt. SRT/VTT benötigen keine zusätzlichen Werkzeuge. Eingebettete Textuntertitel erfordern **ffmpeg und ffprobe**, ASS/SSA erfordern ffmpeg. Über **Subtitle track** wählst du die Spur.
- **Create transcript note** speichert Originaltext und vorhandene Übersetzungen in einer Markdown-Seite. Zeitmarken öffnen das Video an der passenden Stelle. Nach dem Verschieben der Originaldatei müssen die Links aktualisiert werden.
- Ohne Untertitel kann die Mikrofontaste den Ton über den eingerichteten Groq/OpenAI-Whisper-Dienst transkribieren. Dabei wird Audio übertragen; beim bloßen Öffnen des Videos nicht. Bildbasierte oder ins Bild eingebrannte Untertitel lassen sich nicht als Text extrahieren. Die Wiedergabe hängt vom Codec ab; empfohlen sind H.264/AAC MP4 oder WebM.

Klicke bei lokalen Videos oder YouTube oben rechts im Untertitelbereich auf **AI help**. Nutze **Summarize video**, **Explain this moment** oder eigene Fragen mit Rückfragen. Zeitmarken in Antworten springen zur Videostelle; **Save chat to note** exportiert den Chat.

Die KI erhält Untertitel, Abspielposition, jüngste Nachrichten und ausgewählte Bilder: das aktuelle Bild, sechs über das Video verteilte Bilder oder nur Untertitel. Sie sieht nicht jeden Frame und hört nicht die gesamte Tonspur. Zusammenfassungen langer Transkripte verarbeiten alle Abschnitte; normale Fragen können nur relevante Auszüge erhalten. Fehler bei der Bilderfassung und unvollständiger Kontext werden angezeigt. Frühere Bilder werden nicht erneut angehängt.

Der eingerichtete KI-Anbieter wird verwendet. **Video chat Codex model** legt nur das Chatmodell fest; leer übernimmt es das Übersetzungsmodell. Wähle ein für dein Konto verfügbares Modell und bei Bildern eines mit Bildunterstützung. Codex/Claude nutzen die Anmeldung der lokalen CLI, OpenAI/Anthropic die API-Schlüssel. Beim Senden einer Frage wird der Kontext an diesen Dienst übertragen. **Stop** stoppt nur den Chat; bereits gesendete API-Anfragen können auf dem Server weiterlaufen.

Der Verlauf wird lokal je Video gespeichert: die letzten 100 Videos mit jeweils bis zu 200 Nachrichten. Jede Anfrage sendet höchstens 30 aktuelle Nachrichten mit insgesamt 24.000 Textzeichen erneut. Ältere Gespräche werden nicht automatisch zusammengefasst. Bilder werden nicht im Verlauf gespeichert. **Clear chat** löscht den Verlauf dieses Videos, aber keine exportierten Notizen. Bewahre `data.json` mit Einstellungen und Verlauf vertraulich auf.
