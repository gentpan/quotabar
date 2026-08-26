# QuotaBar

macOS 14+ menu-bar app that shows how much of each AI coding provider's quota is
used and when each window resets. Swift 6 toolchain, SwiftUI `MenuBarExtra`, no
third-party dependencies.

- `Sources/QuotaCore` — provider protocol, HTTP/date helpers, config + keychain,
  credential readers, cost estimator, one file per provider group.
- `Sources/QuotaBar` — the SwiftUI app: usage store, menu-bar icon, panel,
  settings, notch island.
- `Tests/QuotaCoreTests` — everything testable lives in QuotaCore.

## Build

**A full Xcode toolchain is required.** CommandLineTools does not ship the
`SwiftUIMacros` plugin, so `@State` fails to expand and the build dies with
`external macro implementation type ... could not be found`.

```bash
export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer
swift build && swift test
./Scripts/package_app.sh   # builds QuotaBar.app in place, ad-hoc signed
```

`package_app.sh` signs with a Developer ID certificate when one is present
(hardened runtime + secure timestamp, which is what notarization requires) and
falls back to ad-hoc otherwise. `NOTARIZE=1` additionally submits to Apple and
staples the ticket; it needs a `notarytool` keychain profile. The script prints
the Gatekeeper verdict at the end — do not assume a build is distributable
because it compiled.

`Scripts/release.sh` wraps that into a full release (zip + SHA-256 + Homebrew
cask) and hard-fails if `spctl` still rejects the bundle — a build that only
works on the developer's own Mac must never ship.

Distribution is Developer ID only. The App Store sandbox forbids reading
`~/.codex` / `~/.claude` and other apps' keychain items, which is the entire
feature set, so `Resources/QuotaBar.entitlements` is deliberately empty and the
app runs unsandboxed.

`Scripts/dev.sh` runs the bare debug binary — fast, but there is no bundle, so
`Bundle.main.bundleIdentifier` is nil. Anything gated on a bundle (notifications,
`SMAppService`, `AppIcon.icns`) must degrade instead of trapping.

## Looking at the UI

```bash
.build/debug/QuotaBar --snapshot ./snapshots
```

Renders the panel off-screen to PNGs (both languages, four states) — the app is
a menu-bar agent, so there is no window to screenshot. CI runs this as a smoke
test. Three `ImageRenderer` limitations to read past; none of them reflect the
running app:

- `ScrollView` contents are not laid out — panels render with `scrollable: false`.
- AppKit-backed controls (`.borderless` buttons, `ProgressView`) come out as
  yellow placeholder glyphs.
- `SettingsView` is excluded: it assigns `@State` from `onAppear`, which the
  renderer cannot service and traps on.

## Rules

### Bilingual UI

Every user-visible string goes through `L10n.t("English", "中文")`. There is no
`.strings` bundle on purpose: `package_app.sh` assembles the app by hand and the
dev loop runs the bare binary, so a `Bundle.module` lookup would behave
differently between the two. Brand names (`ProviderID.displayName`) stay
untranslated.

### Credentials

Manually entered tokens/cookies/API keys go to the **login keychain only**, via
`ConfigStore.setCredential`. Never write a secret to `config.json`; `QuotaConfig`
decodes a legacy `credentials` key purely to drain it into the keychain and
never encodes it back. Automatic providers (Codex, Claude, Gemini) read the
session the user's CLI already created — never prompt for a password.

### Dictionaries keyed by an enum do not encode as objects

`Codable` flattens `[ProviderID: T]` into an array (`["codex", value, ...]`),
not an object. This already bit `config.json` and `history.json`. Key persisted
dictionaries by `String` and, if the file shipped before, keep a reader for the
old flat-array form.

### Provider parsing

Split every provider into a networking `fetch` and a pure `static parse(_ data:)`,
then pin the parser with a recorded response in `ProviderParsingTests`. Derive
window labels from what the API reports (`WindowTitle.forSeconds`) — never
hardcode "5-hour window"; the same field is a weekly window on other plans.
Scrub account identifiers out of recorded fixtures.

### Cost estimation

`CostEstimator` reads the CLIs' own session logs. Two things are easy to get
wrong and are covered by tests:

- **Deduplicate.** Claude Code writes the same assistant turn into every session
  file that replays it; over half the rows in a real tree are duplicates. Key on
  `(message.id, requestId)`.
- **Do not double-charge cached input.** Codex reports `input_tokens` inclusive
  of `cached_input_tokens`.

Anthropic charges 1.25x input for a 5-minute cache write and 2x for a 1-hour
one. When touching the price table, re-check the numbers against the
`claude-api` skill rather than memory, and keep the most specific marker first
(`sonnet-5` before `sonnet`).

**The scan is over tens of gigabytes.** A real Codex tree measured 30GB across
112 files, next to 1GB of Claude logs — and the rows that matter are 0.2% of
those bytes. The hot path therefore never builds a `String` per line: it scans
raw bytes with `memchr`/`memmem` and only materialises `Data` for lines that
match. Codex records are matched on the first 8KB only (its `type` field sits
near the start); Claude's must be searched in full because `usage` comes after
the message content. Files are parsed in parallel, largest first. Together these
took a cold scan from 278s to 36s — do not undo them casually, and re-measure
with `QuotaBar --cost` if you touch the scanner.

`ChunkBoundaryTests` exists because every other fixture in the suite is a few
hundred bytes and never crosses a read block. Keep it.

Results are memoised in memory by (path, mtime, size), so steady-state refreshes
are free — but the cost is paid again on every launch. A persistent cache is the
remaining win if that matters.

### Staleness is never silent

A failed refresh keeps the previous numbers as `.stale(snapshot, error:)`, which
renders a banner. Do not collapse it back into `.loaded` — that is how a user
ends up trusting a figure from an expired session.

### Design tokens

Spacing, radii and surfaces come from `Design` in `DesignTokens.swift`. Radius
tiers are deliberate (tile / card / panel); do not flatten them. Cards use a
fill **or** a border, never both, and no gradients or glassmorphism.

## Adding a provider

1. Implement `QuotaProvider` in `QuotaCore/Providers/`, with a pure `parse`.
2. Add the `ProviderID` case: display name, SF Symbol, accent hex, dashboard
   URL, `credentialHint` (nil for automatic providers), `setupHint`.
3. Register it in `ProviderRegistry.make`.
4. Drop a logo PNG at `Sources/QuotaBar/Resources/logos/<rawValue>.png` and keep
   the SVG master in `Assets/`.
5. Add a fixture test.

`ProviderRegistryTests` asserts every case has complete metadata, so a missing
piece fails the suite rather than shipping a blank tile.
