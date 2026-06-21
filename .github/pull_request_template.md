## Summary

- 

## Manual Obsidian Test

- [ ] Download the `contextual-ai-reader-pr-*` artifact from this PR's GitHub Actions run.
- [ ] Unzip it into a test vault at `.obsidian/plugins/contextual-ai-reader/`.
- [ ] Reload Obsidian and enable Contextual AI Reader.
- [ ] Review the `Obsidian E2E` workflow screenshots/logs for macOS and Windows.
- [ ] Test selection popup with `Command` on macOS or `Ctrl` on Windows/Linux.
- [ ] Test vocabulary mode with the intended target language.
- [ ] Test current-file translation if this PR touches translation flow.
- [ ] Test batch translation if this PR touches batch flow.

## Release Readiness

- [ ] `npm run build` passes locally or in CI.
- [ ] `main.js`, `manifest.json`, `styles.css`, and version files are committed when changed.
- [ ] No API keys, personal paths, or local vault data are committed.
- [ ] This PR should not create a GitHub release. Releases happen only after merge to `main` and a version tag.
