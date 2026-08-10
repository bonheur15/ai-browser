# Releasing AI Browser

AI Browser uses Release Please for version and changelog pull requests, electron-builder for native
desktop packages, and GitHub Actions for verification and publication.

## Normal release

1. Merge changes into `main` using Conventional Commit or pull-request titles such as `feat: add
   downloads` or `fix(vault): preserve locked state`.
2. Release Please opens or updates a release pull request containing the next version and
   `CHANGELOG.md` entry.
3. Review and merge that release pull request when the release is ready.
4. The Release workflow creates a draft GitHub Release, verifies the tagged source, builds all
   platform packages, generates an SPDX SBOM and SHA-256 checksums, records build provenance, and
   publishes the release only after every job succeeds.

Release Please uses semantic versioning:

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- A `!` after the type or a `BREAKING CHANGE:` footer creates a major release.

The repository must allow GitHub Actions to create pull requests under **Settings → Actions →
General → Workflow permissions**. The default `GITHUB_TOKEN` is enough for release creation and
packaging. Add a `RELEASE_PLEASE_TOKEN` secret containing a fine-grained token with repository
Contents and Pull requests write access only if release pull requests must trigger other workflows
when Release Please creates or updates them.

## Produced assets

Each stable release publishes x64 packages for all supported desktop platforms:

| Platform | Assets |
| --- | --- |
| Windows | Assisted NSIS installer and portable executable |
| macOS | DMG installer and ZIP archive |
| Linux | AppImage and Debian package |

The release also includes an SPDX JSON SBOM and a `SHA256SUMS` file. GitHub build-provenance
attestations can be checked with:

```bash
gh attestation verify AI-Browser-0.1.0-linux-x86_64.AppImage --repo bonheur15/ai-browser
sha256sum --check AI-Browser-v0.1.0-SHA256SUMS.txt
```

## Signing and notarization

Packages build unsigned when signing secrets are absent. Configure these repository secrets before
presenting a release as trusted to end users:

| Secret | Purpose |
| --- | --- |
| `WIN_CSC_LINK` | Base64 certificate or certificate URL for Windows signing |
| `WIN_CSC_KEY_PASSWORD` | Windows certificate password |
| `MAC_CSC_LINK` | Base64 `.p12` Developer ID certificate or certificate URL |
| `MAC_CSC_KEY_PASSWORD` | macOS certificate password |
| `APPLE_API_KEY_BASE64` | Base64-encoded App Store Connect `.p8` API private key |
| `APPLE_API_KEY_ID` | App Store Connect API key ID |
| `APPLE_API_ISSUER` | App Store Connect issuer ID |

macOS notarization is enabled only when all macOS signing and App Store Connect values are present.

## Manual recovery

The Release workflow can be dispatched manually for an existing version tag. It verifies that the
tag, `package.json`, lockfile, and changelog all describe the same version before replacing assets.
It never creates a missing manual tag.

To test installers without creating a GitHub Release, run **Package Smoke** manually. Its artifacts
are retained for seven days. Local packaging commands are also available:

```bash
npm run package       # unpacked app for the current platform
npm run dist:linux    # AppImage and deb on Linux
npm run dist:mac      # DMG and ZIP on macOS
npm run dist:win      # NSIS installer and portable exe on Windows
```

Do not publish a tag by hand unless recovering a failed release. The normal Release Please path is
the source of truth for versions and changelog entries.
