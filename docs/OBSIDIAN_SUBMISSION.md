# Obsidian Community Plugin Submission

Official guide: https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin

## Current Requirements

- Public GitHub repository.
- `README.md` in the repository root.
- `LICENSE` in the repository root.
- `manifest.json` in the repository root.
- A GitHub release whose tag exactly matches `manifest.json` version.
- Release assets:
  - `main.js`
  - `manifest.json`
  - `styles.css` if present.

## Submission Steps

1. Create a public GitHub repository.
2. Push this repository to GitHub.
3. Run `npm run build`.
4. Commit the generated `main.js`.
5. Create a GitHub release with a tag matching `manifest.json`, for example `1.0.0`.
6. Upload `main.js`, `manifest.json`, and `styles.css` as release assets.
7. Go to https://community.obsidian.md and sign in with an Obsidian account.
8. Link the GitHub account that owns the repository.
9. Open **Plugins** in the sidebar and choose **New plugin**.
10. Enter the public GitHub repository URL and submit.

## Notes For This Plugin

- This plugin is desktop-only because it calls a local executable.
- The README must clearly disclose that selected text and note contents are sent to Codex through the local Codex login.
- The plugin does not use or store OpenAI API keys.
- Full-note and batch commands write directly to Markdown files, so the README should keep a backup warning.
