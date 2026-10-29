# Prompt Goldberg: workshop design

The interface should make three things obvious: what the machine is trying to do, what the marble is doing now, and what the player can change next.

## Simplification after player feedback

The in-app walkthrough is the product's teaching experience, not a script for presenting to judges. Show me how leads through placing one ramp, running the machine, then adding a fan of the player's own. The main workshop has one current machine and one change prompt. A literal “add a fan” selects a fan locally; it does not call the generator. Placement preserves the existing parts, terrain, goals, and name. Run tests the player's arrangement; Undo reverses the last change.

Creating a different machine is a separate, explicitly labeled action. Obvious edit instructions are protected even if that form is open. AI-generated and AI-edited scenes wait for Run rather than starting automatically. The daily challenge, sound control, sharing, and rebuild puzzles are secondary options. As of October 29, [Tripo custom looks](docs/TRIPO.md) live in an optional disclosure: select a part, describe, preview, explicitly apply. They preserve its existing physics and support Undo.

## Visual direction

A warm mechanical workshop: deep teal surfaces, brass-colored actions, sea-green mechanisms, and a coral marble. The small chain-reaction brand mark and the welcome illustration are native code, so they stay crisp without adding image downloads.

| Token | Value | Use |
| --- | --- | --- |
| Background | `#122326` | Overall workbench |
| Panel | `#1c3337` | Mission, prompts, controls |
| Border | `#38565a` | Quiet structure |
| Primary action | `#ffcd73` | Create, Run, build challenge |
| Supporting accent | `#a3d7ca` | Progress and mechanisms |
| Marble accent | `#ffa17f` | Brand and welcome illustration |

Typography uses Segoe UI and system fallbacks. Titles carry the personality; instructions stay compact and literal. Focus rings remain visible. Decorative motion respects reduced-motion preferences.

## Information hierarchy

- **Welcome:** one creation action, an optional one-part lesson, and three usable prompt ideas. The illustration explains the cause-and-effect premise.
- **Stage:** the largest region. Playback, pause, elapsed time, and Fit view sit with the object they control. Camera controls stay independent from the prompt.
- **Mission:** a title, short description, numbered checkpoints, verified status, and entry into the optional building challenge.
- **Prompt:** always available, with explicit New machine and Edit this build modes. Suggestions refer to the current machine. Errors appear beside the input and preserve its text.
- **Library:** a separate view of the ten puzzles, rather than reopening the introductory explanation. Escape closes the dialog and Tab stays inside it.

On mobile the order is stage, mission/build controls, prompt. The header fits at 360 px. Playback remains on the stage, and the mission's action row stays visible while its panel scrolls. Long failure messages can increase the prompt's height. The camera fits the route to the available aspect ratio.

## Interaction decisions

Creation shows a verified result before asking the visitor to solve a puzzle. The first lesson needs only one ramp placement. Watch reveals the whole route; Build resumes the player's arrangement. Revealing an unsolved competitive puzzle carries the stated hint penalty.

Pausing freezes playback for inspection; replay resets the full event sequence. Fit view restores the route after orbiting or zooming. Clicking an editable part inserts its name in the prompt. Part descriptions explain their physical behavior and placement controls.

Requests that cannot be verified keep the existing scene. Drafts and progress are feedback, not finished output. Offline construction is labeled explicitly. The fixed-kit interpretation of themes is described in the product documentation.

## Validation and next research

See [VALIDATION.md](VALIDATION.md) for the automated and browser checks. Mobile checks used Chrome device emulation; Safari and real-device touch testing remain useful. The next product research should be short, unassisted playtests: time to first creation, whether the goal chain is understood, and whether a player can complete the lesson without narration.
