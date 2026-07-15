# AGENTS.md - DBD Map Overlay

## Project

Dead by Daylight map overlay. Electron desktop app for Windows and Linux that displays community-made full-map images in a transparent always-on-top window. It also supports OCR-assisted map detection, an OBS chroma-key window, synchronized lobbies, custom maps, global hotkeys, and Stream Controller config generation.

- **Repo**: `LucaFontanot/dbd-map-overlay` (`master` is the active branch)
- **Site/API**: `https://dbdmap.lucaservers.com`
- **Version**: `package.json` (currently `1.6.2`)
- **License**: Apache 2.0 in `LICENSE`; `package.json` currently has a stale `ISC` value

## Stack

| Layer | Tech |
|---|---|
| Runtime | Electron, Node.js, Chromium; plain CommonJS JavaScript |
| Frontend | Static HTML/CSS/JS, Bootstrap 5, jQuery, Tom Select, Font Awesome |
| HTTP/API | axios; custom proof-of-work header for selected lobby endpoints |
| OCR | tesseract.js v7 with local language-pack cache |
| Images/capture | sharp, image-size, node-screenshots native addon |
| Global input | uiohook-napi hooks WASD/mouse; Koffi calls Windows `SetCursorPos` for edge wrapping |
| Scheduling | cron for lobby polling |
| Updates/builds | electron-updater, electron-builder |
| Package manager | npm; no lockfile is committed (`package-lock.json` and `yarn.lock` are ignored) |

There is no TypeScript, bundler, transpilation, preload bridge, lint configuration, or `electron-store` dependency. Pure modules use Node's built-in `node:test` runner.

## Runtime Architecture

```text
index.js
  -> Wayland check and X11 respawn
  -> single-instance/CLI dispatch
  -> MainWindow + OverlayWindow + Tray + services
       |-> main renderer: src/index.html + src/renderer.js + src/js/*
       |-> transparent overlay: src/map/map.html + renderer.js
       `-> optional OBS window: src/map/map_obs.html + renderer_obs.js
```

- `index.js`: sets `global.dirname`, respawns Wayland sessions with `--ozone-platform=x11`, acquires the single-instance lock, wires all controllers, creates the main/overlay/tray windows, and forwards `show-map=...` arguments from later instances.
- `src/core/main-window.js`: owns the main BrowserWindow, central `map-change` IPC flow, display enumeration, overlay sizing/placement, OBS forwarding, external-link handling, and auto-update status.
- `src/core/overlay-window.js`: transparent, frameless, click-through, always-on-top map window; supports drag mode and persists custom coordinates. Windows reasserts topmost state every second.
- `src/core/obs-window.js`: lazily opened 700x700 OBS capture window with a green background; it is not transparent.
- `src/core/settings.js`: home-grown JSON settings store at `<userData>/settings-app.json`; merges missing defaults in memory and exposes `get-settings`/`save-settings` IPC.
- `src/core/user-data.js`: IPC-backed storage for downloaded maps in `<userData>/photo/` and user imports in `<userData>/custom/`.
- `src/core/hotkeys.js`: persists `<userData>/hotkeys.json`, registers global defaults and per-map shortcuts, and reloads all registrations after changes.
- `src/core/map-detector.js`: DBD-window capture, sharp preprocessing, Tesseract worker lifecycle, localized/fuzzy OCR matching, and detector IPC.
- `src/core/navigation-tracker.js`, `navigation-input.js`, `navigation-math.js`, and `navigation-boundary.js`: Hens333 calibration, global input lifecycle, 30 Hz dead reckoning, image-derived playable silhouettes, and tested pose math.
- `src/core/tray.js`: show/hide/quit tray behavior; close/minimize only hides the main window when `minimizeToTray` is enabled.
- `src/core/stream-deck.js`: directory picker and JSON writer used by the renderer's Linux Stream Controller generator.
- `src/renderer.js`: composition root for renderer feature classes and global UI actions.
- `src/js/images.js`: remote map synchronization, local catalog/cache, search/filtering, command lookup, selection, and map dispatch.
- `src/js/api.js` + `src/js/lobby.js`: private server client and 15-second synchronized-lobby polling for map/rotation updates.
- `src/js/options.js`, `hotkeys.js`, `custom.js`, `streamdeck.js`, `privacy.js`: settings UI, shortcut UI, custom imports, Stream Controller pages, and remote Markdown modals.

## Startup and Data Flow

1. The main process creates the main UI, transparent overlay, tray, settings, storage, hotkey, Stream Controller, and OCR controllers. The OBS window remains closed until requested.
2. Renderer settings initialization registers an anonymous server user if no token exists, then stores the API token/id in `settings-app.json`.
3. On `DOMContentLoaded`, `Images.remoteUpdateImages()` fetches `images.json` from the `generated-pictures` GitHub branch, deletes stale cached maps, and downloads missing/changed assets by MD5 into `<userData>/photo/`.
4. The renderer builds its creator/realm/map catalog from downloaded and custom files, renders object-URL thumbnails, then loads global hotkeys.
5. A selection calls `Images.sendMap()`. Standard/custom cached paths start with a path separator; lobby custom images may be raw base64.
6. `MainWindow` reads a leading-separator path from `<userData>/photo/` or `<userData>/custom/`; otherwise it treats the payload as base64. It calculates aspect ratio, display, size, position, opacity, and rotation, then sends base64 image data to the overlay and any open OBS window.
7. Every `map-change`, including a lobby or manual change, stops active OCR detection.

A fresh install needs network access to populate maps. If remote synchronization fails, existing cached maps remain usable, but a fresh cache has no built-in maps because `maps/` is excluded from packaged applications.

## Map Assets and Lookup

- Source layout: `maps/<Creator>/<Realm>/<Map>.<ext>`.
- Existing formats are `.png`, `.jpg`, and `.webp`; do not assume PNG-only behavior.
- Current source snapshot: 190 images from five creators (`DbDLeague`, `EagerFace`, `Hens333`, `KaiserAleex`, `SamoelColt`).
- `Hens333/` currently contains 45 WebP callout diagrams; most are 2000x2200 and use clock/landmark labels rather than geometric player-position data.
- The source tree is deployment input, not the packaged runtime catalog. `.github/workflows/images-deploy.yml` hashes it and force-updates `generated-pictures` with only `maps/` and `images.json` on every push to `master`.
- Logical command key: `Creator/Realm/MapName`; matching is case-insensitive and the extension is optional.
- Automatic `show-map-command` lookup (OCR and second-instance CLI) is restricted to Hens333; manual catalog selection still supports other creators.
- Internally, catalog/hotkey keys include the filename extension. Paths returned by user-data IPC begin with `/` or `\`.
- `findClosestMapMatch()` considers only Hens333 paths and tries exact logical path, exact basename, basename containment, then bounded edit distance.
- OCR may emit only an English map name, so automatic lookup deliberately matches a basename without requiring a realm segment.
- Realm spelling/capitalization is not fully normalized across creators (for example `MacMillan`/`Macmillan` and accented/unaccented `Lery`). Preserve existing paths unless intentionally migrating all dependent keys.

### Adding or Updating Maps

1. Add or replace an image under `maps/<Creator>/<Realm>/`, preserving the three-level structure.
2. Update `CREDITS.md` for a new creator/source.
3. Ensure the English realm/map name and all translations exist in every `src/i18n/*.json` if OCR must recognize it.
4. Run `node picture-hash.js > images.json` only for a local manifest check; CI creates the deployment manifest automatically.
5. Check command lookup, preferred-creator selection, thumbnail display, and overlay aspect ratio for renamed/new assets.

`scripts/localization/localization.js` describes a generator, but its required `scripts/localization/langs/` inputs are not committed and its generated output directory is absent. Treat `src/i18n/` as manually maintained unless those inputs are supplied.

## OCR Detection

- The visible feature is one-shot: enable `mapDetection`, then press `Ctrl+M`. IPC also exposes continuous start/stop/status, but the current UI does not auto-start continuous scanning.
- `node-screenshots` locates a window whose title contains `DeadByDaylight` or `Dead By Daylight`; it does not read game memory or process state.
- Each tick captures the game window, crops the left 45% and vertical 65-95% region, doubles resolution, grayscales, normalizes, blurs, thresholds, and sends it to Tesseract using sparse-text PSM 11.
- `ocrLanguage=all` creates Latin/Cyrillic and CJK/Thai workers; a selected language creates one worker. Packs are cached under `<userData>/tessdata/`.
- Fifteen `src/i18n/*.json` files map 66 English realm/map labels to localized labels. Matching tries exact, punctuation-stripped, substring, and Levenshtein strategies, then emits `show-map-command` to normal map lookup.
- After asset synchronization, the detector reloads Hens333 realm and map filenames; OCR matches that resolve only to a realm are no longer accepted as successful map detections.
- Unchanged crops and duplicate matches are skipped; successful one-shot detection tears down its workers.

## Settings and Shortcuts

Important defaults in `src/core/settings.js`: size `250`, top-left position `1`, opacity `0.5`, click-through/non-draggable overlay, rotation `0`, display `0`, detection disabled, all OCR languages, navigation speed `0.07` map widths/sec, and mouse sensitivity `0.135` degrees/unit.

`Ctrl/Cmd+Shift+N` makes the overlay interactive: the first click places a normalized Hens333 pin and the second records clockwise facing from map north, then global WASD/mouse tracking starts. The map image remains at its configured fixed rotation; only the pin position and arrow heading change. Hiding the map releases global input and showing the same map resumes it with the calibrated pose; a new OCR scan or different map resets the pose. The user validated calibration plus live position/heading input in Electron on 2026-07-14.

Dead reckoning is approximate: it applies one configurable speed to W/A/S/D, normalizes diagonals, and ignores collision/forced motion. For Hens333 maps, `navigation-boundary.js` extracts the bright-lavender playable silhouette at 128x128 and clamps calibration plus every tick to its outer shape while filling internal artwork/building holes; this is not wall or obstacle collision. `uiohook-napi` supplies absolute global mouse positions rather than Windows `WM_INPUT` deltas, so DBD raw/locked mouse behavior must be validated and may require a replaceable Windows-native input backend. Pause tracking while tabbed out to prevent unrelated input drift.

On Windows, `navigation-input.js` locks to the display containing the first tracked mouse event and wraps either horizontal edge to its center through `windows-cursor.js`; the matching synthetic center event is ignored, allowing unbounded heading changes without false rotation. Tune defaults in `src/core/settings.js` (`navigationMoveSpeed`, `navigationMouseSensitivity`); runtime fallbacks live at the top of `navigation-tracker.js`, UI ranges are in `src/index.html`, and saved values are in `<userData>/settings-app.json`.

While tracking, hold I/J/K/L for map-relative up/left/down/right pose corrections (0.08 map widths/sec) and O/P for counterclockwise/clockwise heading corrections (60 degrees/sec); these fixed rates live in `navigation-tracker.js`.

Default global shortcuts:

- `Ctrl/Cmd+P`: poll the joined lobby immediately.
- `Ctrl/Cmd+H`: toggle the current map.
- `Ctrl/Cmd+R`: rotate by 90 degrees and redisplay.
- `Ctrl/Cmd+M`: run one-shot OCR when detection is enabled.
- `Ctrl/Cmd+Shift+N`: place/re-place the navigation pin and facing direction on the current Hens333 map.
- `Ctrl/Cmd+Shift+Space`: pause/resume global navigation tracking.

Per-map shortcuts are stored by Electron accelerator string and reference full catalog keys.

## External Services

- `dbdmap.lucaservers.com`: anonymous registration and synchronized lobby create/join/status/map/custom-image endpoints.
- `raw.githubusercontent.com/.../generated-pictures`: runtime `images.json` and map assets.
- `raw.githubusercontent.com/.../master`: privacy policy, FAQ, changelog, and credits shown inside modals.
- GitHub Releases/electron-builder metadata: application auto-updates.
- Tesseract language-data host used by tesseract.js on first OCR use.

Custom lobby maps are base64-encoded and uploaded through the lobby API. Local custom maps otherwise remain under `<userData>/custom/`.

## Security and Maintenance Constraints

- Every BrowserWindow uses `nodeIntegration: true` and `contextIsolation: false`; there is no preload/API boundary or CSP. Treat all HTML/Markdown/interpolated strings and IPC arguments as privileged input.
- The global hook observes only WASD state and mouse coordinates, starts after calibration, and stops on pause/reset/quit; Windows tracking may reposition the shared cursor at horizontal display edges. Do not add logging or storage of raw input events.
- Renderer-originated file IPC accepts relative path strings and does not enforce containment. Validate/sanitize paths before expanding file-writing features.
- `MainWindow.checkUpdates()` forces `app.isPackaged` to `true`, so development runs also attempt release update checks unless changed.
- OCR currently writes `debug_raw.png`, `debug_crop.png`, and `debug_preprocessed.png` to the process working directory on each processed capture; these files are unignored and may contain screen content.
- `Settings` initialization is invoked in both its constructor and `src/renderer.js`, which can race duplicate first-run API registration.
- Debug logging currently prints the API bearer token from `API.setToken()`; never include startup logs in reports without redacting credentials.
- `_matchLines()` tests individual and joined localized labels but accepts only names represented by cached Hens333 files.
- In all-language mode, OCR workers run sequentially and stop after the first worker returns any nontrivial lines, not after a confirmed map match.
- Public README/FAQ text can lag implementation; verify behavior in code before repeating compatibility, privacy, or detection claims.

## Development Commands

```bash
npm install
npm start
npm test
npm run build          # Windows + Linux
npm run build:win      # NSIS + portable Windows targets
npm run build:linux    # deb + rpm + AppImage
npm run publish        # manual electron-builder GitHub publication
node picture-hash.js > images.json
```

Build scripts run `scripts/prebuild.sh` first. It requires Bash plus `curl`, `tar`, and npm, installs Windows sharp packages, and fetches missing `node-screenshots` native binaries for Windows/Linux architectures. Build output is `dist/`.

Set `DEBUG=true` before `npm start` to open main-window DevTools. Renderer debug logging is separately hardcoded on in `src/js/logger.js`.

## Validation

`npm test` runs built-in Node tests for navigation boundary extraction, math/lifecycle/input filtering, and Hens333 automatic lookup. There is no lint or automated Electron integration-test setup. At minimum after code changes:

- Run `npm test` and `node --check` on changed JavaScript files.
- Start the Electron app and exercise the affected IPC/window path.
- For map changes, test remote sync/cache, manual selection, hide/toggle, resize/position/rotation, and OBS rendering.
- For OCR changes, test disabled/enabled `Ctrl+M`, selected-language and all-language modes, worker stop behavior, and creator preference against a real DBD loading screen.
- For lobby changes, test creator/joiner standard maps, custom base64 maps, rotation sync, leave/close/reopen, and the 15-second poll.
- Build on the target OS for native-module or packaging changes; a syntax check cannot validate `sharp`/`node-screenshots` binaries.

## CI/CD

- `.github/workflows/images-deploy.yml` is the only enabled workflow and publishes the map asset branch from `master`.
- `.github/workflows/release.yml.disabled` is inactive.
- Application releases are manual via the npm `publish*` scripts and electron-builder/GitHub credentials.

---

## Self-Updating Rule

**AGENTS.md is the source of truth for agentic onboarding.** Every time an agent (human or AI) discovers a pattern, convention, or architectural decision that is not documented here - or corrects an outdated entry - it MUST update this file. Specifically:

1. **Before starting any task**: Read `AGENTS.md` to understand the project.
2. **After completing any task**: If you learned something that would help the next agent, add it to `AGENTS.md` under the relevant section. If no section fits, add a new one.
3. **On discovering stale information**: Correct it immediately. Do not work around outdated docs.
4. **Keep it concise**: One-liners preferred. This file is read by agents, not humans seeking tutorials. No fluff.
5. **Never remove the self-updating rule**: This clause must survive all edits.

*Last updated: 2026-07-14*
