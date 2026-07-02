// The world: owns creatures, plant food, the spatial grids, and the tick loop.
// Pure simulation — no DOM — so it runs identically in the browser and in the
// headless tuning harness.

import { CONFIG as C } from './config.js';
import { Creature, resetIds } from './creature.js';
import { SpatialGrid } from './spatial.js';
import { randomGenome, mutate } from './genome.js';

export class World {
  constructor(cfg = C) {
    this.width = cfg.world.width;
    this.height = cfg.world.height;
    this.creatures = [];
    this.food = [];         // {x, y, eaten}
    this.freeFood = [];     // indices of eaten pellets to recycle
    this.liveFood = 0;
    this.foodGrid = new SpatialGrid(this.width, this.height, cfg.world.cell);
    this.creatureGrid = new SpatialGrid(this.width, this.height, cfg.world.cell);
    this.time = 0;          // sim-seconds elapsed
    this.tick = 0;
    this.foodRegenMul = 1;  // god-mode famine/abundance modifier
    this.regenCarry = 0;
    this.births_deaths = { births: 0, starved: 0, aged: 0, predated: 0, eaten: 0 };
    this.reset();
  }

  reset() {
    resetIds();
    this.creatures.length = 0;
    this.food.length = 0;
    this.freeFood.length = 0;
    this.liveFood = 0;
    this.time = 0;
    this.tick = 0;
    this.foodRegenMul = 1;
    for (let i = 0; i < C.foodStart; i++) this.spawnFood();
    for (let i = 0; i < C.startCount; i++) {
      const g = randomGenome();
      this.creatures.push(
        new Creature(g, Math.random() * this.width, Math.random() * this.height, this, 0, 0)
      );
    }
  }

  spawnFood() {
    if (this.liveFood >= C.foodMax) return;
    const x = Math.random() * this.width;
    const y = Math.random() * this.height;
    if (this.freeFood.length) {
      const idx = this.freeFood.pop();
      const f = this.food[idx];
      f.x = x; f.y = y; f.eaten = false;
    } else {
      this.food.push({ x, y, eaten: false });
    }
    this.liveFood++;
  }

  onFoodEaten(f) {
    // f.eaten already set true by the creature
    this.liveFood--;
    // find its index lazily: store index on the object for O(1) recycle
    this.freeFood.push(f._i);
  }

  reproduce(parent) {
    if (this.creatures.length >= C.maxCreatures) return;
    const childEnergy = parent.energy * C.reproChildFraction;
    parent.energy -= childEnergy;
    const cg = mutate(parent.g);
    const angle = Math.random() * Math.PI * 2;
    const child = new Creature(
      cg,
      parent.x + Math.cos(angle) * (parent.radius + 4),
      parent.y + Math.sin(angle) * (parent.radius + 4),
      this,
      parent.id,
      parent.generation + 1
    );
    child.energy = childEnergy;
    this.creatures.push(child);
    this.births_deaths.births++;
  }

  // Advance one fixed sim step.
  update() {
    const dt = C.dt;
    this.time += dt;
    this.tick++;

    // ---- rebuild grids ----
    this.foodGrid.clear();
    for (let i = 0; i < this.food.length; i++) {
      const f = this.food[i];
      f._i = i;
      if (!f.eaten) this.foodGrid.insert(f);
    }
    this.creatureGrid.clear();
    for (let i = 0; i < this.creatures.length; i++) {
      this.creatureGrid.insert(this.creatures[i]);
    }

    // ---- step creatures ----
    const list = this.creatures;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.dead) c.step(dt, this.foodGrid, this.creatureGrid);
    }

    // ---- reap dead ----
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.dead) {
        if (c.deathCause === 'starvation') this.births_deaths.starved++;
        else if (c.deathCause === 'age') this.births_deaths.aged++;
        // predation already counted
      } else {
        list[w++] = c;
      }
    }
    list.length = w;

    // ---- regrow food ----
    this.regenCarry += C.foodRegen * this.foodRegenMul * dt;
    while (this.regenCarry >= 1) {
      this.spawnFood();
      this.regenCarry -= 1;
    }
  }

  // ---------------- God-mode events ----------------
  meteor() {
    // Kill ~70% at random.
    const list = this.creatures;
    for (let i = 0; i < list.length; i++) {
      if (Math.random() < 0.7) list[i].kill('age');
    }
    return { type: 'meteor', killed: 0.7 };
  }

  famine() {
    // Halve standing food immediately and slow regrowth for a while.
    let killed = 0;
    for (const f of this.food) {
      if (!f.eaten && Math.random() < 0.5) { f.eaten = true; this.liveFood--; this.freeFood.push(f._i ?? this.food.indexOf(f)); killed++; }
    }
    this.foodRegenMul = 0.4;
    setTimeoutSafe(() => (this.foodRegenMul = 1), 12000);
    return { type: 'famine', killed };
  }

  abundance() {
    for (let i = 0; i < 500; i++) this.spawnFood();
    this.foodRegenMul = 2.2;
    setTimeoutSafe(() => (this.foodRegenMul = 1), 12000);
    return { type: 'abundance' };
  }
}

// setTimeout exists in browser and Node; guard for exotic hosts.
function setTimeoutSafe(fn, ms) {
  if (typeof setTimeout === 'function') setTimeout(fn, ms);
}
