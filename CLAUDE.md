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

### Config decoding is per-field lenient

`decodeIfPresent` tolerates a *missing* key but throws on an unrecognised
value, which fails the whole file and silently resets every other preference.
Enum fields therefore go through `decodeEnum`, and `enabled` through
`decodeProviders`, which drops ids this build does not know rather than
discarding the list. This matters on downgrade: a newer build writes a style
or a provider an older one cannot parse. Covered by `ConfigResilienceTests`.

### Dictionaries keyed by an enum do not encode as objects

`Codable` flattens `[ProviderID: T]` into an array (`["codex", value, ...]`),
not an object. This already bit `config.json` and `history.json`. Key persisted
dictionaries by `String` and, if the file shipped before, keep a reader for the
old flat-array form.

### Window rows carry structure, not a sentence

A `UsageWindow` reports `windowSeconds` and `scope` separately from its
`title`. The UI renders the length as a badge ("5h", "7d") and the scope as the
only caption, so an account-wide window gets no caption at all — repeating
"whole account" on every row is filler. Providers that know the length must set
`windowSeconds`; `title` stays as the full label for accessibility and for rows
with no fixed length (balances, billing cycles).

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

The accent is a neutral graphite **and inverts between appearances**
(`QuotaTheme.accentHex` / `accentDarkHex`): a dark selection block sinks into a
dark window, so dark mode gets a light block with dark ink. It is neutral on
purpose — the panel already carries eleven provider brand colours and a twelfth
competing hue makes none of them legible. `QuotaBar --theme-preview <dir>`
renders the panel across candidate accents if it ever needs revisiting.

The glyph reports whichever provider the panel is focused on — `selected` in
the config, persisted, because it decides what the icon means and a choice that
reset on every launch would change that silently. An unknown or since-disabled
id falls back to the overview, which aggregates across everything enabled.

The glyph is driven by a `MeterReading`, not one number: quota windows split
into a **short** horizon (under a day — 5-hour, rolling) and a **long** one (a
day or more, plus billing cycles with no fixed length), each taking the highest
reading across enabled providers. `dual` draws them as two stacked rows and is
the default; every other style collapses them to `headline` (the higher of the
two). Collapsing hides which limit is actually near — a real account here reads
31% short against 100% long, and a single meter shows only the 100%.

A plan may report just one horizon (a Codex Pro account has no 5-hour window),
so `dual` falls back to a single centred row rather than drawing an empty one,
which would read as "nothing left".

Nine menu-bar glyphs live in `MenuBarIcon`. Four of them are *stepped*
(`dual` 5, `segments` 5, `grid` 9, `columns` 4) and declare it via
`MenuBarStyle.steps`: their gradations are countable, so the reading is exact
rather than estimated off a continuous fill.

Prefer linear gradations. A 3x3 `grid` is the most distinctive glyph but the
least readable: proportion along one axis is preattentive, while a grid has to
be counted in two dimensions. Ten segments were also tried and are worse than
five — at 22pt each cell falls to ~2pt and a filled cell stops being
distinguishable from an outlined one, so the finer gradations bought nothing. A stepped glyph
lights a cell only once its step is fully reached — except that any non-zero
value lights the first cell, or 1% and 0% look identical. **Unlit cells are
drawn as outlines, never as a faint fill**: alpha alone stops distinguishing
them once the glyph is tinted for an alert, and an exhausted quota then looks
identical to a full one. `QuotaBar
--icon-preview <dir>` renders every style across nine levels plus the Settings
picker, in both appearances.

Opening Settings takes two steps, not one: `openSettings()` followed by
`SettingsWindow.focus()`. The call alone does create the window, but an
accessory app is never activated as a side effect, so it is ordered in behind
whatever the user was looking at and the menu just closes with nothing visible.
Activating *before* the window exists does nothing — hence the runloop hop.
The legacy `showSettingsWindow:` selector does not work here at all; do not
reach for it.

The panel does not scroll. Only the notch island does, because it lives in a
fixed-size floating `NSPanel`; a clipped menu-bar panel hides the numbers the
app exists to show.

Snapshots render light **and** dark (`-dark` suffix). Dark mode needs
`NSAppearance.performAsCurrentDrawingAppearance` — adaptive colours resolve
against the drawing appearance, which `ImageRenderer` does not inherit from the
SwiftUI environment.

### Credential sources

Six ways a provider gets its credential, in order of preference:

1. **CLI login file** — Codex (`~/.codex/auth.json`), Gemini, Grok, OpenCode Go
   (`~/.local/share/opencode/auth.json`), read in the clear.
2. **Another app's keychain item** — Claude Code.
3. **Another app's local session store** — Cursor keeps its signed-in session
   in `state.vscdb`, a plain SQLite file (`SQLiteRead`). Not the cookie jar,
   which only holds the in-app browser's third-party cookies. The cookie
   cursor.com wants is `sub::JWT`, not the bare token — `sub` is a claim inside
   the JWT, and the composite is percent-encoded into the cookie.
4. **Manual paste** — the fallback for everything, stored in the keychain.

An automatic reader is always tried *after* a manually pasted credential, so a
user can override a stale local session. A provider that has both an automatic
reader and a manual fallback keeps its `credentialHint` non-nil.

There is no OAuth-in-app path: of the eleven providers only Google (Gemini)
permits third-party client registration, and it is already covered by the CLI
login file. Do not embed another CLI's `client_id`, and never a `client_secret`.

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
