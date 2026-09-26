# Read & Watch with AI en Français

[English](https://github.com/skye1349/contextual-ai-reader/blob/main/README.md) · [中文](https://github.com/skye1349/contextual-ai-reader/blob/main/README.zh-CN.md) · [日本語](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ja.md) · [한국어](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ko.md) · [Español](https://github.com/skye1349/contextual-ai-reader/blob/main/README.es.md) · [Deutsch](https://github.com/skye1349/contextual-ai-reader/blob/main/README.de.md)

## 1.2.0 : nouveau nom et configuration API

**Contextual AI Reader** devient **Read & Watch with AI**. L’ID interne et l’URL du dépôt restent identiques pour conserver réglages, caches et historiques. Les chemins déjà enregistrés sont conservés ; les nouvelles installations utilisent le nouveau nom.

Choisissez **OpenAI-compatible API** ou **Anthropic API token** dans **AI backend**, puis renseignez la clé, l’URL de base et le modèle correspondants. OpenAI : `https://api.openai.com/v1` ; Claude : `https://api.anthropic.com/v1`. Codex, Claude Code, Node.js et un abonnement CLI ne sont pas nécessaires. Cela couvre les sélections/textes PDF, le vocabulaire, les notes complètes et lots, les sous-titres, les résumés vidéo, les questions de suivi et les images. Les images nécessitent un modèle avec vision. **Test text / Test image** envoient de petits tests avec une image synthétique ; des frais peuvent s’appliquer.

**Auto** privilégie la clé compatible OpenAI, puis Anthropic, puis les CLI locales. Choisissez explicitement **Codex** pour utiliser la connexion locale. La transcription sans sous-titres se configure séparément via **Transcription API key / base URL / model** ou Groq. Le service doit prendre en charge `/audio/transcriptions`, `verbose_json` et les segments horodatés. La clé de chat n’est réutilisée que si les deux URL de base correspondent. Une clé Claude ne permet pas d’appeler OpenAI Whisper. Les clés, protocoles et capacités des modèles ne sont pas interchangeables. L’extraction des CC, les captures et la lecture vocale système ne nécessitent pas de clé IA.

Read & Watch with AI est un plugin Obsidian desktop pour la lecture assistée : traduction, explication de vocabulaire en contexte, lecture vocale, notes d'extraits, PDF sélectionnables et traduction de fichiers Markdown.

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

- `Auto`: clés OpenAI/Anthropic en priorité, puis CLI locales.
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


## Nouveautés de 1.1.0 : vidéos locales et chat IA

Lancez **Open local video** depuis la palette de commandes, puis choisissez un fichier ou collez son chemin absolu. Le fichier peut se trouver hors du coffre. Le lecteur partage avec YouTube la lecture, la navigation par phrase, les sous-titres bilingues, le cache de traduction, le plein écran dans la fenêtre, les captures et l’export de notes.

- Les fichiers associés tels que `lesson.srt`, `lesson.en.srt` et `lesson.zh.vtt` sont détectés automatiquement. SRT/VTT ne nécessitent aucun outil externe. Les pistes de texte intégrées nécessitent **ffmpeg et ffprobe** ; ASS/SSA nécessitent ffmpeg. Choisissez la piste avec **Subtitle track**.
- **Create transcript note** enregistre le texte original et les traductions disponibles dans une page Markdown. Les horodatages rouvrent la vidéo au bon endroit. Déplacer le fichier original nécessite de mettre à jour les liens.
- Sans sous-titres, le bouton microphone permet une transcription avec le service Groq/OpenAI Whisper configuré. Cette opération transmet l’audio ; ouvrir la vidéo ne le transmet pas. Les sous-titres graphiques ou gravés dans l’image ne sont pas extraits comme texte. La lecture dépend des codecs ; MP4 H.264/AAC ou WebM sont recommandés.

Cliquez sur **AI help** en haut à droite du panneau de sous-titres, pour une vidéo locale ou YouTube. Utilisez **Summarize video**, **Explain this moment**, ou posez des questions successives. Les horodatages des réponses permettent de naviguer ; **Save chat to note** exporte la conversation.

L’IA reçoit les sous-titres, la position, la conversation récente et les images choisies : l’image actuelle, six images réparties dans la vidéo, ou uniquement les sous-titres. Elle ne regarde pas toutes les images et n’écoute pas directement toute la bande-son. Les longs résumés traitent tous les segments de transcription ; les questions ordinaires peuvent utiliser seulement des extraits pertinents. Les échecs de capture et la couverture partielle sont signalés. Les anciennes images ne sont pas jointes de nouveau.

Le fournisseur IA configuré est utilisé. **Video chat Codex model** définit uniquement le modèle du chat ; vide, il reprend celui de traduction. Choisissez un modèle disponible pour votre compte, compatible avec les images si nécessaire. Codex/Claude utilisent la connexion de la CLI locale ; OpenAI/Anthropic utilisent les clés API. Envoyer une question transmet le contexte au fournisseur. **Stop** arrête seulement le chat ; une requête API déjà envoyée peut se terminer côté serveur.

L’historique est enregistré localement par vidéo : les 100 vidéos les plus récentes, jusqu’à 200 messages chacune. Chaque requête retransmet au maximum 30 messages récents et 24 000 caractères de texte. Les anciens échanges ne sont pas résumés automatiquement. Les images ne sont pas conservées dans l’historique. **Clear chat** efface la conversation de cette vidéo, sans supprimer les notes exportées. Gardez confidentiel `data.json`, qui contient les réglages et l’historique.
