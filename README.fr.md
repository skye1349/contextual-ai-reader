# Contextual AI Reader en Français

[English](https://github.com/skye1349/contextual-ai-reader/blob/main/README.md) · [中文](https://github.com/skye1349/contextual-ai-reader/blob/main/README.zh-CN.md) · [日本語](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ja.md) · [한국어](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ko.md) · [Español](https://github.com/skye1349/contextual-ai-reader/blob/main/README.es.md) · [Deutsch](https://github.com/skye1349/contextual-ai-reader/blob/main/README.de.md)

Contextual AI Reader est un plugin Obsidian desktop pour la lecture assistée : traduction, explication de vocabulaire en contexte, lecture vocale, notes d'extraits, PDF sélectionnables et traduction de fichiers Markdown.

## Configuration requise et installation

Utilisez Obsidian desktop sur macOS, Windows ou Linux. Sur mobile, les notes synchronisées restent lisibles, mais les outils CLI et vidéo locaux ne peuvent pas s'exécuter. Community Plugins ne nécessite ni Node.js, ni npm, ni le dépôt source. Choisissez un backend IA :

- Codex : installez [Codex App ou CLI](https://developers.openai.com/codex/cli), puis exécutez `codex login` pour la CLI.
- Claude Code : installez Claude Code et connectez-vous.
- API : configurez une clé OpenAI ou Anthropic ; aucune CLI locale n'est requise.

Les sous-titres YouTube protégés, la capture d'images vidéo propres et la transcription sans CC nécessitent des outils supplémentaires.

| Système | Installer `yt-dlp` et `ffmpeg` |
| --- | --- |
| macOS | `brew install yt-dlp ffmpeg` |
| Windows | `winget install yt-dlp.yt-dlp` et `winget install Gyan.FFmpeg` |
| Ubuntu/Debian | `sudo apt update && sudo apt install yt-dlp ffmpeg` |
| Autre Linux | Utilisez le gestionnaire de paquets de la distribution |

Redémarrez Obsidian après l'installation. Si la détection automatique échoue, indiquez le chemin complet de l'exécutable dans les réglages. La transcription sans CC exige aussi une clé Groq ou OpenAI.

## Données locales et cache

Les réglages, clés API, cache de vocabulaire, sous-titres et traductions YouTube sont enregistrés pour chaque coffre dans `<vault>/.obsidian/plugins/contextual-ai-reader/data.json`. Pour conserver le cache, ne supprimez pas `data.json`, le dossier du plugin ou ses données. Copiez ce fichier de façon privée lors d'un changement de coffre.

Le cache conserve les 30 vidéos les plus récentes. Les captures et notes de transcription sont des fichiers ordinaires du coffre et ne sont pas supprimées avec le cache. `data.json` peut contenir des clés API : ne le publiez pas, ne le partagez pas et ne l'ajoutez pas à Git.

## Fonctionnalités

- Choisir la langue source ou utiliser la détection automatique.
- Choisir la langue d'apprentissage/cible pour les traductions et les explications.
- Afficher le popup en sélectionnant du texte avec `Command` sur macOS ou `Ctrl` sur Windows/Linux.
- Pour un mot ou un court terme, utiliser d'abord le cache et la traduction rapide, puis l'IA peut expliquer le sens dans le paragraphe actuel.
- Si la langue cible est le chinois et le mot sélectionné est anglais, un petit dictionnaire local anglais-chinois est aussi utilisé.
- Traduire le fichier Markdown actuel et ajouter la traduction sous l'original.
- Traduire le fichier Markdown actuel en paragraphes intercalés source/cible.
- Traduire plusieurs fichiers Markdown par chemin, dossier ou wildcard.
- Afficher le token usage lorsque le backend IA le fournit.

## Backends IA

Choisissez `AI backend` dans les paramètres.

- `Auto`: Codex local d'abord, puis Claude Code si nécessaire.
- `Codex`: CLI Codex local et session locale.
- `Claude Code`: CLI Claude Code local et session locale.
- `OpenAI API token`: API key OpenAI.
- `Anthropic API token`: API key Anthropic.

## Configuration

- `Source language`: langue du texte lu. Utilisez `Auto detect` en cas de doute.
- `Learning / target language`: langue de sortie pour traduction et vocabulaire.
- `Require Command/Ctrl key for auto translate`: recommandé pour éviter les déclenchements accidentels.
- `Custom prompt / context`: livre, domaine, terminologie et style souhaité.
- `Reasoning effort`: pour la traduction, `none` est généralement plus rapide et moins coûteux.

## Utilisation

1. Ouvrez une note Markdown ou un PDF avec texte sélectionnable.
2. Maintenez `Command` sur macOS ou `Ctrl` sur Windows/Linux et sélectionnez du texte.
3. Le popup apparaît près de la sélection.
4. Utilisez Sparkles pour une traduction ou explication IA.
5. Utilisez Copy pour copier ou Book plus pour enregistrer dans la note d'extraits.

## Traduction Markdown

Commandes disponibles :

- `Translate current Markdown file and append translation`
- `Translate current Markdown file with interleaved translation`

Pour la traduction par lot, les chemins sont relatifs au vault.

```text
Books/Example/
Books/Example/Chapter 1.md
Books/Example/*.md
Books/Example/**/*.md
```

## Confidentialité

Ce plugin n'est pas une traduction hors ligne. Selon le backend choisi, le texte sélectionné ou le Markdown peut être envoyé à Codex, Claude Code, OpenAI API ou Anthropic API. Les API keys sont stockées dans les paramètres locaux d'Obsidian.

## License

MIT
