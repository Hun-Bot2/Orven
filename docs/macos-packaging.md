# Local macOS app and DMG packaging

The current packaging profile creates a local **ad-hoc signed macOS app**
and a non-notarized disk image. The DMG itself has no Developer ID signature. It does not establish Developer ID identity, public
release readiness, Apple approval, clean-machine installation, or successful
native authentication. No artifact is uploaded or installed by the build command.
The application identifier and account storage namespace remain unchanged.

## Build

Run on macOS from `desktop/`, with the supported Cargo toolchain on PATH:

```sh
npm ci
npm run package:macos
```

The script sets `CI=true`, using Tauri's supported path that skips Finder cosmetic
AppleScript. This avoids requiring Finder automation permission during packaging;
it retains the app and Applications drop link but omits custom installer icon
positioning/background layout. The initial interactive build waited in its cosmetic
AppleScript and was stopped; no macOS privacy setting was changed.

This runs the production frontend build and Rust release build, then creates:

- `target/release/bundle/macos/Orven.app` (from the repository root)
- `target/release/bundle/dmg/Orven_0.2.0_aarch64.dmg` on Apple Silicon

The build uses the host architecture by default. An Apple Silicon build is not an
Intel or universal build. Build outputs stay under the already ignored `target/`;
private review files, `.dev.vars`, repositories and account data are not configured
as bundle resources. Local font files are included for offline rendering.

The default configuration explicitly uses `signingIdentity: "-"` for local ad-hoc
signing. A Developer ID distribution profile and notarization require a separate
approved setup; do not describe this package as notarized or bypass macOS security
settings. No Apple credentials are needed for this local profile. Official guidance:
[Tauri DMG](https://v2.tauri.app/distribute/dmg/) and
[macOS signing](https://v2.tauri.app/distribute/sign/macos/).

## Validate locally

From the repository root:

```sh
codesign --verify --deep --strict --verbose=2 target/release/bundle/macos/Orven.app
hdiutil verify target/release/bundle/dmg/Orven_0.2.0_aarch64.dmg
shasum -a 256 target/release/bundle/dmg/Orven_0.2.0_aarch64.dmg
```

A valid local signature or disk image does not prove Gatekeeper acceptance. For
manual use, mount the disk image and drag Orven into Applications when desired;
the build does not replace any existing installation or stop a running app.

The frontend CSP/loopback credentials and policy tests are separate from native
painting, VoiceOver, app restart restoration, logout revocation and actual MCP-host
interoperability. The Worker confirmation page is deployed separately; rebuilding
the desktop does not deploy the Worker or migrate D1.

## Pre-package verification, 2026-11-10

- Worker TypeScript and 53 local Workers/D1 tests passed.
- Frontend TypeScript, formatting and 32 browser tests passed.
- Production preview under the native CSP: one shell, zero JS/CSP failures.
- Rust workspace: 43 passed, one opt-in real Keychain test ignored.
- Clippy with warnings denied and Rust formatting passed.
- Operator reported reaching GitHub's verified-account confirmation. Full live
  native credential/restoration/revocation verification remains a separate gate.

These are executed pre-package checks, not a claim that the generated installer
was installed, externally distributed or independently accepted by macOS.

## Local artifact receipt, 2026-11-10

The release build completed for arm64/macOS with app version 0.2.0 and identifier
`dev.orven.desktop`. The app is approximately 14.12 MiB and DMG 4.47 MiB.
`codesign --verify --deep --strict` passed on both the standalone app and the copy
mounted read-only from the DMG. `hdiutil verify` passed. All app file hashes matched
between the standalone and mounted copies, and the installer contains an
`Applications -> /Applications` link. The verification volume was detached.

DMG SHA-256 for this build:

```text
43648af29b1cba3e5e1ce095b19bd0706bb70973b981eef80e41a351af21ca51
```

A bounded check found no exact local GitHub client-secret value in the app files;
`.dev.vars` and the private review note are absent. This is not proof that every
possible sensitive value is absent. No installed app was replaced, no account data
was changed, and no package was uploaded. Fresh-install launch, Gatekeeper acceptance,
VoiceOver, final native optical alignment and full live account lifecycle remain
unverified. The package uses CI mode after the interactive Finder cosmetic step
waited and was explicitly stopped; no automation permission was changed.
