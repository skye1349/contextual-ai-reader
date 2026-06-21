# Contributing And Release Workflow

This project uses a branch-based workflow. Do not commit feature work directly to `main`.

## Normal Change Flow

1. Start from an up-to-date `main`.

   ```bash
   git switch main
   git pull
   git switch -c codex/my-feature
   ```

2. Make the change on the feature branch.
3. Run the local build.

   ```bash
   npm run build
   ```

4. Commit source files and generated plugin assets when they changed.

   ```bash
   git add src/main.ts main.js styles.css manifest.json package.json package-lock.json versions.json README*.md
   git commit -m "Describe the change"
   git push -u origin codex/my-feature
   ```

5. Open a pull request into `main`.
6. Wait for the Pull Request workflow to pass.
7. Download the `contextual-ai-reader-pr-*` artifact from the workflow run.
8. Install that artifact into a test Obsidian vault and manually test the plugin.
9. Merge the PR only after CI and manual Obsidian testing pass.

## Manual Obsidian Testing From A PR Artifact

The Pull Request workflow uploads an installable zip artifact.

1. Open the PR's `Checks` or `Actions` page.
2. Download `contextual-ai-reader-pr-*`.
3. Unzip it.
4. Copy the `contextual-ai-reader` folder into a test vault:

   ```text
   <test-vault>/.obsidian/plugins/contextual-ai-reader/
   ```

5. Reload Obsidian.
6. Enable `Contextual AI Reader`.
7. Test the feature before merging.

Use a test vault, not a vault with important notes, when validating file-writing features such as full-file translation or batch translation.

## What CI Can And Cannot Test

The Pull Request workflow runs on:

- Ubuntu
- macOS
- Windows

It verifies that the plugin builds on all three platforms, validates metadata, scans for common release blockers, checks that generated build assets are committed, runs Obsidian-backed E2E smoke tests on macOS and Windows, and uploads an installable plugin package.

GitHub Actions cannot provide a reliable interactive Obsidian desktop session for manual exploratory testing. Instead, the E2E job launches a sandboxed Obsidian instance automatically and uploads screenshots/logs. Manual exploratory testing can still happen in a local Obsidian test vault using the PR artifact when a change is risky.

## Release Flow

Only release from `main`, but do not commit the release bump directly on `main`.

1. Merge the tested feature PR into `main`.
2. Create a release branch from the latest `main`.

   ```bash
   git switch main
   git pull
   git switch -c codex/release-1.0.8
   ```

3. Bump the version in `package.json`, `manifest.json`, and `versions.json`.
4. Run `npm run build`.
5. Commit the release bump and open a release PR.
6. Wait for the Pull Request workflow to pass.
7. Merge the release PR into `main`.
8. Pull the latest `main`.
9. Create and push a tag that exactly matches `manifest.json` version.

   ```bash
   git switch main
   git pull
   git tag 1.0.8
   git push origin 1.0.8
   ```

The Release workflow creates the GitHub release assets and artifact attestations. Obsidian Community Plugins will pick up the new release after the tag release is published.

## Recommended GitHub Repository Setting

Enable branch protection for `main`:

- Require a pull request before merging.
- Require status checks to pass before merging.
- Require the `Build and validate` and `Package PR plugin artifact` workflow jobs.
- Require the `Obsidian E2E` workflow jobs.
- Restrict direct pushes to `main`.

This repository setting is what actually prevents accidental direct pushes to `main`.
