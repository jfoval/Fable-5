# SUSPECT

A noir interrogation game. Claude Fable 5 plays a suspect with something to hide.
You get one room, a stack of evidence, and exactly one accusation. Break them — or
let the wrong person walk.

Every case is generated fresh and locked behind a hidden **truth file**: the real
crime, the hour-by-hour timeline, whether this suspect actually did it, what they're
hiding either way, the evidence, and the seams a sharp detective can pull. The suspect
lies only where the truth forces them to and improvises consistently everywhere else.
When the case ends you see the whole truth file next to your transcript — every lie in
red, every truth in green. That screen is the proof the AI held a hidden, consistent
state the entire time.

![Interrogation](https://img.shields.io/badge/scene-noir-e8b667) ![Model](https://img.shields.io/badge/model-claude--fable--5-c33b34)

## Run it

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Then open **http://localhost:5173**. That's the whole install — zero dependencies,
just Node 18+.

No key? It still runs. The game falls back to one hand-authored case (*The Last Reel*)
with a scripted suspect, so the full loop — interrogate, confront, break, reveal — demos
end to end. Set the key to get freshly generated suspects instead.

## How to play

1. **Pick a difficulty and hit NEW CASE.** The truth file is generated once and never
   touched again.
2. **Read the file, enter the room.** Type questions. She answers in character, with a
   physical *tell* under each line — a tapped table, eyes that won't meet yours. The
   tells get louder as her **composure** drops.
3. **Work the statement log.** Every factual claim she makes becomes a pinnable card.
   Pin two of them — or a claim against a piece of evidence — and hit **CONFRONT**.
   An adjudicator rules on whether it's a real contradiction. Land it and her composure
   craters and she scrambles to revise. Miss and she mocks you and steadies.
4. **Break her or call it.** At zero composure she cracks — a full confession if guilty,
   or she blurts the real secret if she's innocent. Or spend your one **ACCUSE**: charge
   the guilty and you win; charge the innocent and they lawyer up.
5. **Watch the reveal.** Transcript on the left, the locked truth on the right, every
   lie and truth color-coded.

### Difficulty

| Mode | Lies | Tells | Composure |
|------|------|-------|-----------|
| **Nervous First-Timer** | clumsy, over-explained | obvious from the start | cracks fast |
| **Cold Professional** | smooth, minimal | subtle — a pause, a too-steady voice | recovers well |
| **Pathological Liar** | reflexive, even about trivia | misleading on purpose | slippery |

## What's under the hood

- **`server.js`** — zero-dependency Node server. Serves the static front end and proxies
  three endpoints so the API key never touches the browser: `/api/case`,
  `/api/reply`, `/api/confront`. With no key, every endpoint transparently returns the
  bundled scripted case.
- **`lib/prompts.js`** — the three prompt surfaces (case architect, suspect roleplay,
  contradiction adjudicator) and the difficulty tuning. Shared verbatim between the live
  server and the test harness, so what ships is exactly what's tested.
- **`lib/anthropic.js`** — thin Messages-API client plus a resilient JSON extractor.
- **`public/`** — vanilla JS. Canvas rain (`rain.js`), a fully procedural suspect
  silhouette whose idle animation decays as composure falls (`silhouette.js`),
  synthesized rain + heartbeat audio (`audio.js`), typewriter dialogue, film grain, and
  the game state machine (`main.js`). No framework, no build step.

## Testing

```bash
npm run selftest    # deterministic, no key — JSON plumbing, truth-file schema,
                    # offline interrogation arc, confront hit/miss, crack

ANTHROPIC_API_KEY=sk-... npm run playtest    # 3 full interrogations vs the real model
```

The live playtest simulates a detective across three generated cases and verifies the
things that matter: every suspect reply is strict JSON, the suspect never volunteers the
secret before cracking, confronting a *seeded* inconsistency scores as a hit while a
bogus pairing misses, and an average case resolves in **8–15 questions**.

## Config

- `ANTHROPIC_API_KEY` — enables generated cases and the live model. Absent → bundled case.
- `PORT` — defaults to `5173`.
- Model is `claude-fable-5`.

## License

MIT.
