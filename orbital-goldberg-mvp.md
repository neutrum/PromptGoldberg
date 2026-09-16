# Orbital Goldberg: MVP Plan

Victoria VR AI Builder Hackathon 2026 (solo entry)
Working name, placeholder.

## One-line pitch

Describe a cosmic chain reaction in plain language, and the AI builds a star system, simulates gravity, tests whether it worked, repairs it until it does, and explains every miss.

## Core loop

1. User types a goal, for example: *"A comet swings past the gas giant, gets flung to the twin moons, and ends up orbiting the smaller one."*
2. The LLM outputs a structured system (bodies, orbits, launch parameters) plus the goal as an ordered sequence of checkable events.
3. The simulation runs and an event detector logs what happened.
4. If the goal fails, the system repairs the setup and reruns. The user watches the attempts.
5. On success, the user can ask *"why did attempt 2 fail?"* or edit by talking.

## Key technical decision

LLMs are bad at precise numbers, so the work is split:

- **The LLM designs the structure:** which bodies exist, rough orbits, the order of flybys.
- **A numeric optimizer tunes the numbers:** launch speed, angle, timing.
- **The LLM redesigns only when tuning cannot fix it.**

This makes the repair loop far more reliable and is a clear story for judges.

## MVP scope

### Must have

- N-body gravity simulation (leapfrog integrator, fixed timestep, units in AU, years, solar masses), running in a Web Worker. Shared TypeScript so it also runs on the server.
- Body types: star, planet, moon, comet/probe.
- Event types: close flyby, capture into orbit, collision, escape, eclipse.
- Goal defined as an ordered list of events, checked automatically.
- LLM to JSON schema, with validation and auto-fix of invalid output.
- Repair loop: optimizer first, LLM redesign second, maximum about 5 attempts.
- "Ask why" answered from the event log, with the moment highlighted on a timeline.
- Talk-to-edit (*"make the gas giant heavier"*).
- React Three Fiber rendering with orbit trails, time controls, and attempt history (ghost trails of failed runs).

### Cut from MVP

- Real star catalog data
- Relativity and spacecraft fuel models
- Multiplayer
- VR
- Voice or hum input
- Generated 3D assets beyond simple bodies

## Stack

- **Frontend:** React Three Fiber, TypeScript, Web Worker for simulation
- **Backend:** small Node service (LLM calls, schema validation, headless simulation for the repair loop)
- **AI:** Claude API for design, repair decisions, explanations, and edits
- **Hosting:** own VPS or managed host (must stay up through judging, until Nov 25)
- **Licensing:** permissive only (MIT, Apache). No copyleft, no non-commercial assets. Keep `CREDITS.md` from day one.

## Timeline (Sep 16 to Nov 11)

| Dates | Goal |
|---|---|
| Sep 16 to 22 | Simulation, renderer, hand-written system JSON, one goal checker. Prove a manual slingshot works. |
| Sep 23 to 29 | All event types, event log, timeline UI. |
| Sep 30 to Oct 6 | Prompt to schema, validation, 10 test prompts. |
| Oct 7 to 13 | Repair loop (optimizer plus LLM redesign). Riskiest week. |
| Oct 14 to 20 | Ask-why and talk-to-edit. |
| Oct 21 to 27 | Curveball prompts, off-topic handling, rate limits, cost cap. |
| Oct 28 to Nov 3 | Visuals, sound, onboarding with example prompts, deploy. |
| Nov 4 to 10 | Demo video (under 3 min), description, credits. Submit a day early. |

Official deadline: **Nov 11, 16:30 CEST**.

## Success criteria

- 8 of 10 test prompts reach their goal within 5 attempts.
- First visible system within about 5 seconds, full solve within about 30 seconds.
- Off-topic prompts still produce something sensible.

## Demo prompts to design around

- *"A moon that eclipses its sun every 3 days."*
- *"Send a probe to the outer planet using two slingshots."*
- *"A rogue planet passes through and steals a moon."*

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Chaotic systems break with tiny changes | Keep goals short (2 to 3 events), let the optimizer do fine tuning |
| LLM outputs invalid or impossible systems | Strict schema, validation, auto-repair, sensible defaults |
| Judges use off-topic prompts | Redirect gracefully or reinterpret in a space theme |
| API cost during judging | Server-side keys, rate limits, caching, budget cap |
| Similar existing tools | Position as goal-driven, self-verifying creative tool, not a manual sandbox |

## Submission checklist

- [ ] Public code repository
- [ ] Hosted browser demo link (backend live through judging)
- [ ] Demo video under 3 minutes
- [ ] Short written description
- [ ] Focus category selected (likely "Procedural worlds and storytelling systems" or "AI-assisted games and interactive experiences", confirm on Discord)
- [ ] `CREDITS.md` with all third-party and AI-generated materials

## Next step

Draft the system JSON schema and event types. Everything else builds on them.
