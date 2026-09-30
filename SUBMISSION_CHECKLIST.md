# yh-InkLight Community Directory Submission Checklist

Submit through https://community.obsidian.md/account/plugins/new.
Official guide: https://docs.obsidian.md/plugins/releasing/submit-plugin.

## Repository and manifest

- [ ] Keep the plugin ID `yh-inklight` stable.
- [ ] Use the Basic Latin display name `yh-InkLight`.
- [ ] Keep the short description under 250 characters and end it with a period.
- [ ] Set `minAppVersion` to a supported version; release 0.23.5 requires 1.7.2.
- [ ] Keep `isDesktopOnly` consistent with the runtime APIs and tested devices.
- [ ] Include README.md, LICENSE, source files, and third-party attribution.
- [ ] Disclose any remote services, account/payment requirements, or access outside the vault.
- [ ] Commit the current manifest on the repository's default branch.

## Validation and release

- [ ] Run `npm run verify` (tests, type check, release metadata).
- [ ] Run `npm run build` and confirm the committed main.js matches the production bundle.
- [ ] Match manifest.json, package.json, package-lock.json, and versions.json metadata.
- [ ] Create a non-draft GitHub release whose tag exactly matches the manifest version, without a `v` prefix.
- [ ] Attach main.js, manifest.json, and styles.css individually.
- [ ] Test the release in a separate vault, including Markdown, PDF, EPUB, and mobile behavior.

## Community directory submission

- [ ] Sign in with the Obsidian account that will maintain this plugin.
- [ ] Connect the GitHub repository owner's account; verify `Connected as rezonegame`.
- [ ] Choose Plugins -> New plugin and enter https://github.com/rezonegame/yh-inklight.
- [ ] Select the owner and acknowledge the developer policies and maintenance commitment.
- [ ] Submit and inspect the manifest, assets, source, and build review results.
- [ ] Resolve errors in a new incremented release. Warnings are recommendations to address.
- [ ] Use Review branch for a preview scan when available.
- [ ] Complete the listing and publish once installation-blocking errors are resolved.

## After submission

- [ ] Keep listing descriptions, categories, and screenshots accurate.
- [ ] Publish future updates as GitHub releases; initial submission does not need to be repeated.
- [ ] Use the management page's Check for new releases or Request review when needed.
