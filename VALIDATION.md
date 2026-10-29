# Validation — 2026-10-29

Local revision, not a deployed release.

## Optional Tripo appearances

- 214 tests passed across 28 files. Typecheck and production build passed; the existing large JavaScript/WASM bundle warning remains.
- One real Tripo task produced a textured brass bell with a red wooden knob: 1,946,740 bytes, 20 reported credits. Subsequent browser checks reused that saved model without submitting another provider task.
- Chrome checked the development and production builds: preview, explicit saved-result disclosure, apply, successful Run, Restore original look and Undo. The machine's title and goal stayed intact; development checks also compared geometry and the deterministic physics trace.
- A simulated model-service failure preserved the current machine. The optional drawer fit a 390-pixel viewport. No browser runtime exceptions occurred in these checks.
- Typing “add a fan” still selected a local part for placement, with no machine creation or edit request.
- Server regressions cover duplicate submission prevention, persistent daily caps, recovery of a known provider task after restart, malformed/external-resource GLBs, unavailable service and credential handling. Store tests cover stale-target guards and preserving or discarding appearance references during AI edits.

Production browser evidence is in ignored `data/workshop-check/tripo-production-check.log` and `22-tripo-production.png`; full test output is in `final-tests.log`. See [Tripo setup and scope](docs/TRIPO.md). The broader wooden-diorama redesign is still pending.

The local usage-limit watchdog separately passed three offline regression tests, including an empty quota snapshot, waiting until reset, and preventing a duplicate continuation after restart. Its native queue connection test succeeded. An earlier real denial exposed the empty-snapshot bug; the corrected watcher is running, but successful recovery after a real usage-limit reset has not yet been observed.

## Earlier follow-up: simpler interaction

- 203 tests passed after adding five regressions for default editing, literal add commands, placement/Undo, cancellation, and preserving the current machine's identity.
- Browser reproduction: “add a fan” made no create/edit API call, selected a fan, preserved the existing scene, placed exactly one new part, waited for Run, and supported Undo.
- The same command was protected when the New machine form was open. R rotated once and Escape cancelled placement.
- The guided lesson progressed from a pointer-placed ramp, through a successful run, to adding a fan to that same machine.
- Typecheck and production build passed. Mobile layout was inspected at 390×844.
- Tripo was deferred at this stage; the integration above supersedes that decision.

The checks below record the preceding design pass; its immediate-playback behavior and Create/Edit tabs have since been replaced by the simpler interaction above.

| Check | Result |
| --- | --- |
| `npm test` | 198 tests passed across 27 files |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; Vite reports the existing large JavaScript/WASM bundle sizes |
| `git diff --check` | Passed, with Windows line-ending conversion notices |
| Guided lesson in Chrome | Ramp placed by pointer; solved in one try; server trace agreed |
| Offline creation and recovery | Verified route created; unsupported two-marble request preserved the previous build and prompt |
| Watch/Build | Correct scene switch, persistent prompt, resumable placements |
| Playback and camera | Pause held time fixed, resume completed, second replay completed, Fit view restored framing |
| Library and dialogs | Separate library opened; Escape closed it |
| Mobile layout | 390×844 and 360×800 emulation; header controls fit; stage, prompt and error state inspected |
| Production browser with real AI | Creation and edit completed with verified results, no offline notice, no browser runtime exceptions |

The final production browser check requested “Fire a pizza marble from a cannon over a river into an oven bucket”, then “Paint the ramp coral and call the ball pizza”. Observed times were 4.505 seconds for creation and 1.807 seconds for the edit. These are individual measurements, not service-level guarantees or a broad prompt-success benchmark.

The regression coverage includes preservation of failed/cancelled requests, edits against player placements, mode switching, strict compilation, explicit requirement checks, rejection of unchanged edits, and appearance changes that preserve geometry. Browser checks used actual Chrome and pointer placement; the production run used the shipped bundle without development store hooks.

Local scripts, traces, and screenshots are under ignored `data/workshop-check/`. Human enjoyment, unrestricted prompt interpretation, real-device touch behavior, and hosted availability are not established by these checks. [DEMO.md](DEMO.md) describes the supported demonstration and remaining submission preparation.
