// A creature: a body driven by an evolvable brain reading local perception.
// It senses the nearest food, the nearest thing it could hunt, and the nearest
// thing that could hunt it, then steers by four brain-controlled gains. Nothing
// about *where* it goes is scripted — only the wiring between senses and
// muscles, which evolves.

import { CONFIG as C } from './config.js';
import { think } from './brain.js';

let NEXT_ID = 1;
export function resetIds() { NEXT_ID = 1; }

const TWO_PI = Math.PI * 2;

export class Creature {
  constructor(genome, x, y, world, parentId = 0, generation = 0) {
    this.id = NEXT_ID++;
    this.g = genome;
    this.x = x;
    this.y = y;
    this.heading = Math.random() * TWO_PI;
    this.energy = C.startEnergy;
    this.age = 0;
    this.parentId = parentId;
    this.generation = generation;
    this.world = world;
    this.dead = false;
    this.attackTimer = 0;
    this.eating = 0;   // visual pulse when it just ate
    this.attacking = 0;
    // cached radius
    this.radius = 4 + genome.size * 5;
    this._in = new Float32Array(11);
  }

  get isPredatorType() {
    return this.g.diet > 0.5;
  }

  metabolicCost() {
    const g = this.g;
    return (
      C.baseBurn +
      C.moveBurn * g.speed * g.size +
      C.sizeBurn * g.size * g.size +
      C.visionBurn * g.vision
    ) * g.metabolism;
  }

  step(dt, foodGrid, creatureGrid) {
    const g = this.g;
    const W = this.world;

    // ---- SENSE ---------------------------------------------------------
    const inp = this._in;
    for (let i = 0; i < 11; i++) inp[i] = 0;
    inp[10] = 1; // bias

    // nearest food
    let fBestD2 = Infinity, fdx = 0, fdy = 0, foodItem = null;
    const vis = g.vision;
    foodGrid.query(this.x, this.y, vis, (f, dx, dy) => {
      if (f.eaten) return;
      const d2 = dx * dx + dy * dy;
      if (d2 < fBestD2) { fBestD2 = d2; fdx = dx; fdy = dy; foodItem = f; }
    });
    if (foodItem) {
      const d = Math.sqrt(fBestD2) || 1;
      inp[0] = fdx / d;
      inp[1] = fdy / d;
      inp[2] = 1 - d / vis;
    }

    // nearest prey (smaller creature) and nearest threat (bigger hunter)
    let pBestD2 = Infinity, pdx = 0, pdy = 0, prey = null;
    let tBestD2 = Infinity, tdx = 0, tdy = 0;
    creatureGrid.query(this.x, this.y, vis, (o, dx, dy) => {
      if (o === this || o.dead) return;
      const d2 = dx * dx + dy * dy;
      // could I eat it? (I must be meaningfully bigger)
      if (this.radius > o.radius * C.attackRatio) {
        if (d2 < pBestD2) { pBestD2 = d2; pdx = dx; pdy = dy; prey = o; }
      }
      // could it eat me? (it is a hunter and bigger)
      if (o.g.diet > 0.45 && o.radius > this.radius * C.attackRatio) {
        if (d2 < tBestD2) { tBestD2 = d2; tdx = dx; tdy = dy; }
      }
    });
    if (prey) {
      const d = Math.sqrt(pBestD2) || 1;
      inp[3] = pdx / d; inp[4] = pdy / d; inp[5] = 1 - d / vis;
    }
    if (tBestD2 < Infinity) {
      const d = Math.sqrt(tBestD2) || 1;
      inp[6] = tdx / d; inp[7] = tdy / d; inp[8] = 1 - d / vis;
    }
    inp[9] = Math.min(1, this.energy / C.reproThreshold) * 2 - 1;

    // ---- THINK ---------------------------------------------------------
    const out = think(g.brain, inp);
    // Innate coupling to body plan: grazers weight plants, hunters weight prey.
    const gFood = out[0] * (1 - g.diet);
    const gPrey = out[1] * g.diet * (0.4 + 0.6 * g.aggression);
    const gFear = out[2];
    const gWander = out[3];

    // ---- DESIRE VECTOR -------------------------------------------------
    let vx = 0, vy = 0;
    if (foodItem) { const d = Math.sqrt(fBestD2) || 1; vx += gFood * fdx / d; vy += gFood * fdy / d; }
    if (prey)     { const d = Math.sqrt(pBestD2) || 1; vx += gPrey * pdx / d; vy += gPrey * pdy / d; }
    if (tBestD2 < Infinity) { const d = Math.sqrt(tBestD2) || 1; vx -= gFear * tdx / d; vy -= gFear * tdy / d; }
    // wander
    this._wander = (this._wander || this.heading) + (Math.random() - 0.5) * C.wanderJitter * dt;
    vx += gWander * Math.cos(this._wander) * 0.7;
    vy += gWander * Math.sin(this._wander) * 0.7;

    // ---- STEER + MOVE --------------------------------------------------
    let speed = C.baseSpeed * g.speed;
    if (vx !== 0 || vy !== 0) {
      const desired = Math.atan2(vy, vx);
      let diff = desired - this.heading;
      while (diff > Math.PI) diff -= TWO_PI;
      while (diff < -Math.PI) diff += TWO_PI;
      const maxT = C.maxTurn * dt;
      if (diff > maxT) diff = maxT; else if (diff < -maxT) diff = -maxT;
      this.heading += diff;
    } else {
      speed *= 0.4;
    }
    this.x += Math.cos(this.heading) * speed * dt;
    this.y += Math.sin(this.heading) * speed * dt;

    // toroidal-ish soft walls: wrap keeps the world seamless and busy
    const w = W.width, h = W.height;
    if (this.x < 0) this.x += w; else if (this.x >= w) this.x -= w;
    if (this.y < 0) this.y += h; else if (this.y >= h) this.y -= h;

    // ---- METABOLISM ----------------------------------------------------
    this.energy -= this.metabolicCost() * dt;
    this.age += dt;
    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (this.eating > 0) this.eating -= dt * 3;
    if (this.attacking > 0) this.attacking -= dt * 3;

    // ---- EAT PLANTS ----------------------------------------------------
    if (foodItem && !foodItem.eaten) {
      const reach = C.eatRadiusBase + this.radius * 0.5 + C.foodRadius;
      if (fBestD2 <= reach * reach) {
        foodItem.eaten = true;
        const gain = C.foodEnergy * (1 - C.plantDigest * g.diet);
        this.energy += gain;
        this.eating = 1;
        W.onFoodEaten(foodItem);
        W.births_deaths.eaten++;
      }
    }

    // ---- HUNT ----------------------------------------------------------
    if (prey && !prey.dead && g.diet > 0.35 && this.attackTimer <= 0) {
      const reach = C.attackReach + this.radius * 0.6;
      if (pBestD2 <= reach * reach) {
        this.attackTimer = C.attackCooldown;
        this.energy -= C.attackCost;
        this.attacking = 1;
        const gain = (prey.energy * C.meatGainEnergy + prey.size * C.meatGainSize) *
                     (1 - C.meatDigest * (1 - g.diet));
        this.energy += Math.max(0, gain);
        prey.kill('predation');
        W.births_deaths.predated++;
      }
    }

    // ---- REPRODUCE -----------------------------------------------------
    if (this.energy >= C.reproThreshold && this.age >= C.reproMinAge) {
      W.reproduce(this);
    }

    // ---- DIE -----------------------------------------------------------
    const maxAge = C.maxAgeBase / g.metabolism;
    if (this.energy <= 0) this.kill('starvation');
    else if (this.age > maxAge) this.kill('age');
  }

  get size() { return this.g.size; }

  kill(cause) {
    if (this.dead) return;
    this.dead = true;
    this.deathCause = cause;
  }
}
