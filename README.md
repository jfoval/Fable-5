# ♠ BLUFF

**Two Claude Fable 5 agents play heads-up no-limit Texas Hold'em while the audience reads their private thoughts in real time.**

Spectators see *everything* — both hole cards, both inner monologues, both reads
on the opponent. Each agent sees only what a real player at the table could ever
know. That gap between what you know and what they know is the entire show.

It looks like a televised poker final with mind-reading: a green-felt table,
two glass "thought panels" streaming each agent's reasoning with a typewriter
effect, chips that pile up, a pot that visibly grows, and a verdict banner that
calls every hand — **STONE COLD BLUFF: IT WORKED** or **THE READ WAS RIGHT**.

---

## Run it

```bash
npm start
```

Then open **http://localhost:5173**. Zero dependencies, no build step, no
`npm install` — just vanilla JS and one small Node server (Node 18+).

### With real reasoning (recommended)

Every decision is a single Claude Fable 5 API call. Provide a key and the agents
actually think:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

The key **never leaves the server** — the browser posts to a local `/api/agent`
proxy and only ever receives the model's text back.

### With no key (graceful fallback)

Without a key, BLUFF opens with a **hand-authored classic bluff** (a fixed deck,
so it plays out identically every time) and then keeps the match going with a
persona-flavoured offline brain. The full broadcast still demos — table, panels,
stats, audit, replay, end screen — so you can see everything without an API key.

---

## What you're looking at

| Region | What it shows |
| --- | --- |
| **Center felt** | The table: both players' hole cards (face up, for you), the community board, the pot, chip bets, and the dealer button. |
| **Left / right glass panels** | Each agent's live `inner_monologue` (typewriter), its one-line `read_on_opponent`, its chosen action, and whether it came from the live API, the scripted demo, or the offline brain. |
| **Stats strip** | Per agent: hands won, bluffs attempted vs. bluffs that worked, aggression frequency, biggest pot dragged. Plus the commentator ticker. |

### Controls

| Control | Effect |
| --- | --- |
| **❚❚ / ▶** or `Space` | Play / pause |
| **1× 2× 3×** | Playback speed |
| **AUTO** | Auto-deal the next hand (off = press `N` to deal each hand) |
| **📺 COMM** | Toggle the ESPN-style commentator (one extra API call after big pots) |
| **🔊** | Mute the all-in heartbeat |
| **🛡 AUDIT** (`A`) | Open the information-hygiene audit |
| **⧉ REPLAY** (`R`) | Step through the last hand, monologue beside each action |

The table dims, a heartbeat kicks in, and the thought panels lock on every
all-in. When someone busts, an end screen charts both stacks across the whole
match and calls out the single biggest bluff and the worst call.

---

## Information hygiene — the integrity of the demo

If one agent ever saw the other's cards or reasoning, the whole thing would be
fake. So the guarantee is enforced *and proven*:

- The payload built for each agent contains only its **own** hole cards, the
  **public** board, pots, stacks, the public betting history, and the opponent's
  **spoken** table talk. The opponent's hole cards and private monologue are
  never placed in it — not even from past hands.
- Every payload is recorded in an **audit log**. The **🛡 AUDIT** viewer re-scans
  each one live and shows, per payload, that the opponent's hole cards and
  thoughts are absent — highlighting what the agent *did* see (own cards teal,
  public board gold). One leak and it turns red.
- The server also appends every real payload to `audit.log` on disk as
  ground truth.

---

## Verify it yourself

```bash
npm test        # hand evaluator + poker engine + agent pipeline
npm run headless # play 10+ full hands and assert the integrity guarantees
```

- **`npm test`** runs the hand-evaluator unit tests (wheel straights, flush over
  flush, full house vs. quads, identical-kicker chops, and a 400-hand
  brute-force cross-check that our best-of-7 equals the true maximum), the poker
  engine tests (blinds, position, min-raise, all-ins, side pots, split pots), and
  the agent-pipeline tests (malformed JSON, code fences, illegal actions — all
  resolve to a legal action, never a crash).
- **`npm run headless`** plays a full match through the *exact* decision pipeline
  and asserts: no hand crashed, no payload leaked a card or a thought, every
  decision has a monologue. With `ANTHROPIC_API_KEY` set it runs against the
  **real** Claude Fable 5 API; without one it exercises the identical path via
  the offline brain.

### Project layout

```
server.js                 zero-dep static server + /api/agent & /api/commentator proxy
public/
  index.html              app shell (setup screen + broadcast layout)
  styles.css              broadcast graphics package (dark, felt, glass panels)
  src/
    cards.js              card representation, deck, seedable shuffle
    evaluator.js          best-5-of-7 hand evaluator (pure, unit tested)
    engine.js             heads-up NLHE state machine + tournament (Match)
    personas.js           the cast: play styles + voices
    agent.js              builds the redacted payload, parses/validates, retries
    brain.js              offline heuristic brain + the scripted classic hand
    audit.js              the integrity ledger + leak scanner
    orchestrator.js       drives a match: engine + agents + audit + stats
    ui.js                 table, cards, chips, thought-panel typewriter, overlays
    audit-view.js         the information-hygiene viewer
    replay-view.js        post-hand replay browser
    end-view.js           bust screen: stack chart, biggest bluff, worst call
    net.js                browser <-> server proxy
    main.js               setup, playback clock, match loop, controls, dramatics
tools/
  evaluator.test.js       hand-evaluator edge cases + brute-force cross-check
  engine.test.js          betting rules, side pots, min-raise, showdown
  agent.test.js           JSON parsing / retry / fallback (never crashes)
  headless-match.js       full-match integrity run (real API or offline)
  shot.mjs                headless-browser smoke test (screenshots the broadcast)
```

---

## License

MIT
