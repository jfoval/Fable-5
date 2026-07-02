// All the knobs that shape the ecology in one place. These were tuned by
// repeated headless runs (see tools/tune.js) until evolution visibly happens:
// measurable trait drift and at least one boom/bust cycle within ~5 sim-minutes.

export const CONFIG = {
  world: { width: 1600, height: 1000, cell: 70 },

  // Population
  startCount: 220,
  maxCreatures: 720,

  // Food (plant energy)
  foodMax: 900,          // carrying-capacity cap on pellets
  foodStart: 620,
  foodRegen: 42,         // pellets spawned per sim-second (baseline)
  foodEnergy: 26,
  foodRadius: 3.2,

  // Creature energy economy
  startEnergy: 62,
  reproThreshold: 118,
  reproChildFraction: 0.5,   // energy handed to the child
  reproMinAge: 6,            // sim-seconds before a creature can breed
  maxAgeBase: 66,            // divided by metabolism → lifespan
  baseBurn: 0.85,            // resting metabolic cost / sim-second
  moveBurn: 0.5,             // extra cost scaling with speed*size
  sizeBurn: 0.42,            // extra cost scaling with body size
  visionBurn: 0.0016,        // cost of maintaining large eyes (per vision unit)

  // Eating / predation
  plantDigest: 0.72,         // how much of plant energy a full carnivore loses
  eatRadiusBase: 6,          // + size scaling, for reaching food
  attackRatio: 1.08,         // attacker.size must exceed prey.size * this
  attackReach: 8,            // + size scaling, contact range for a kill
  meatGainEnergy: 0.72,      // fraction of prey energy captured
  meatGainSize: 24,          // flat bonus scaled by prey size
  meatDigest: 0.62,          // how much meat a pure grazer fails to digest
  attackCost: 0.6,           // energy spent per attack attempt
  attackCooldown: 0.28,      // sim-seconds between attacks

  // Movement
  maxTurn: 4.6,              // radians/sec steering limit
  baseSpeed: 78,             // world-units/sec at speed-gene = 1
  wanderJitter: 2.4,

  // Reproduction pacing (keeps booms from being instantaneous)
  dt: 1 / 30,               // fixed sim step (sim-seconds)
};
