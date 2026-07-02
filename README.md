# Primordial

**A browser-based artificial-life simulator where digital creatures evolve in real time — narrated live by Claude Fable 5.**

Hundreds of procedurally-drawn cells drift across a dark arena, eating regrowing
plant food, hunting each other, reproducing, and dying. Every creature carries a
**genome** (speed, size, vision, metabolism, aggression, diet) and a tiny
**neural network** that reads what it can actually see and decides where to go.
Nothing is scripted. Genomes mutate on reproduction, selection does the rest, and
within a few minutes you watch grazers boom and bust, predators evolve out of the
herd, and traits split into distinct forms.

A side panel — **Field Notes** — sends a compact world-state summary to
Claude Fable 5 every ~20 seconds and narrates what's happening in the voice of a
fascinated naturalist, referencing the *real* trends in the data.

---

## Run it

```bash
npm start
```

Then open **http://localhost:5173**. That's the whole thing — zero dependencies,
no build step, vanilla JS + one small Node server.

### Enable the narrator (optional)

The narrator uses the Anthropic API. Provide a key and the "Field Notes" panel
comes alive:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Without a key the badge reads **"Narrator offline"** and the simulation runs
exactly as normal — the key never leaves the server (the browser calls a local
`/api/narrate` proxy, never the Anthropic API directly).

> Requires Node 18+ (uses the built-in `fetch`). No `npm install` needed.

---

## What to do

| Control | Effect |
| --- | --- |
| **▶ / ❚❚** (or `Space`) | Play / pause |
| **Speed 1×–10×** | Run 1–10 simulation steps per frame |
| **Click a creature** | Inspect its genome, vitals, and lineage |
| **☄ Meteor** | Cataclysm — kills ~70% of all life at random |
| **✷ Famine** | Halves standing food and slows regrowth |
| **✿ Abundance** | Floods the world with food |
| **↻ New world** | Reseed a fresh founding population |

Watch the two charts on the left: **Population by species** (grazers / omnivores /
hunters as a stacked area) and **Average traits over generations**. Fire a meteor
during a population peak and watch which lineages survive the bottleneck.

---

## How it works

- **World & creatures** — a 1600×1000 arena with plant-food pellets that regrow to
  a carrying-capacity cap. Each creature senses the nearest food, the nearest thing
  it could hunt, and the nearest thing that could hunt it.
- **Brains** — an 11→8→4 feed-forward net whose weights live in the genome. It
  outputs four steering gains (seek food, pursue prey, flee, wander). The net is
  seeded with a sensible prior so gen-0 isn't dead on arrival, then **evolves**.
- **Energy economy** — movement, size, vision, and metabolism all cost energy;
  plants feed grazers, meat feeds hunters, and each digests the other poorly. The
  constants are tuned so **both grazing and hunting strategies are viable**, which
  is what produces predator–prey cycles.
- **Selection** — reproduce when energy crosses a threshold (halving it into a
  mutated child); die from starvation, old age, or predation.
- **Performance** — a uniform spatial-hash grid keeps neighbour queries near-O(1).
  Measured cost at ~370 creatures is ~2.3 ms/frame (update + render), i.e. well
  above 60 fps with 300+ creatures.
- **Emergence detection** — the world is sampled every 2.5 s to track population by
  cluster and trait distributions, and to flag booms, crashes, extinctions,
  predator–prey cycles, and trait divergence (proto-speciation). Those events drive
  both the on-screen ticker and the narrator's context.

### Project layout

```
server.js              zero-dependency static server + /api/narrate proxy
public/
  index.html           app shell
  styles.css           design system (dark, "museum" UI)
  src/
    config.js          all the tuned ecology constants
    genome.js          traits + brain weights, mutation
    brain.js           the tiny neural network
    creature.js        sense → think → steer → eat/hunt → reproduce → die
    spatial.js         uniform spatial-hash grid
    world.js           tick loop, food economy, god-mode events
    emergence.js       clustering, trait tracking, event detection
    render.js          procedural creature rendering (cached sprites)
    charts.js          population + trait charts
    narrator.js        Field Notes panel (Claude Fable 5)
    ui.js              inspector, toasts, banner
    main.js            wiring + animation loop
tools/
  tune.js              headless run: prints trajectory, drift, events, verdict
  shot.mjs / perf.mjs  headless browser smoke + performance checks
```

### Verify evolution yourself (headless, no browser)

```bash
npm run tune          # runs 5 sim-minutes and prints a VERDICT
```

Typical verdict: **survived: YES · trait drift: YES · boom & bust: YES ·
predators arose: YES** — measurable trait shifts and at least one boom/bust cycle,
every run.

---

## License

MIT
