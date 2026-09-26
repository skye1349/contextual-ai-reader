# Obsidian Community Plugin Submission

Official guide: https://docs.obsidian.md/plugins/releasing/submit-plugin

## Current Requirements

- Public GitHub repository.
- `README.md` in the repository root.
- `LICENSE` in the repository root.
- `manifest.json` in the repository root.
- A GitHub release whose tag exactly matches `manifest.json` version, without a `v` prefix.
- Release assets:
  - `main.js`
  - `manifest.json`
  - `styles.css` if present.

## Submission Steps

1. Create a public GitHub repository.
2. Push this repository to GitHub.
3. Run `npm run build`.
4. Commit the generated `main.js`.
5. Push a Git tag matching `manifest.json`, for example `1.0.2`.
6. Let the repository release workflow create the GitHub release, upload `main.js`, `manifest.json`, and `styles.css`, and generate artifact attestations.
7. Go to https://community.obsidian.md and sign in with an Obsidian account.
8. Link the GitHub account that owns the repository.
9. Open **Plugins** in the sidebar and choose **New plugin**.
10. Enter the public GitHub repository URL and submit.

## Notes For This Plugin

- The manifest author is `Taoye`.
- This plugin is desktop-only because it can call local executables.
- The README must clearly disclose that selected text and note contents are sent to the selected AI backend.
- Local Codex and Claude Code modes use local account sessions and do not require API keys.
- OpenAI and Anthropic API modes require API keys, which are stored in local plugin settings.
- Full-note and batch commands write directly to Markdown files, so the README should keep a backup warning.
- Release assets must be published by `.github/workflows/release.yml` so GitHub artifact attestations are generated.

## Community Plugin Entry

Add this object to the end of `community-plugins.json` in `obsidianmd/obsidian-releases`:

```json
{
  "id": "contextual-ai-reader",
  "name": "Read and Watch with AI",
  "description": "Translate documents, learn from videos with bilingual subtitles, and turn screenshots and AI conversations into notes.",
  "author": "Taoye",
  "repo": "skye1349/contextual-ai-reader"
}
```

## Updating an existing listing

Use the Obsidian Community account dashboard, not a pull request to obsidian-releases (pull requests are disabled there). Change the name in manifest.json, publish a release, then select **Check for new releases**. Names cannot contain ampersands; use **Read and Watch with AI**. See https://docs.obsidian.md/Reference/Manifest.
