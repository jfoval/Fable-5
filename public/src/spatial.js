// Uniform spatial hash grid. Keeps neighbour queries near-O(1) so the sim
// stays at 60fps with hundreds of creatures and food pellets. Rebuilt each
// tick (cheap: a couple of array writes per item).

export class SpatialGrid {
  constructor(width, height, cell) {
    this.width = width;
    this.height = height;
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil(width / cell));
    this.rows = Math.max(1, Math.ceil(height / cell));
    this.buckets = new Array(this.cols * this.rows);
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
  }

  clear() {
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i].length = 0;
  }

  _idx(x, y) {
    let cx = (x / this.cell) | 0;
    let cy = (y / this.cell) | 0;
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  insert(item) {
    this.buckets[this._idx(item.x, item.y)].push(item);
  }

  // Visit every item within `radius` of (x,y). `fn(item)` is called for each
  // candidate in range (already distance-filtered).
  query(x, y, radius, fn) {
    const c = this.cell;
    const r2 = radius * radius;
    let minCx = ((x - radius) / c) | 0;
    let maxCx = ((x + radius) / c) | 0;
    let minCy = ((y - radius) / c) | 0;
    let maxCy = ((y + radius) / c) | 0;
    if (minCx < 0) minCx = 0;
    if (minCy < 0) minCy = 0;
    if (maxCx >= this.cols) maxCx = this.cols - 1;
    if (maxCy >= this.rows) maxCy = this.rows - 1;
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.buckets[cy * this.cols + cx];
        for (let i = 0; i < bucket.length; i++) {
          const it = bucket[i];
          const dx = it.x - x;
          const dy = it.y - y;
          if (dx * dx + dy * dy <= r2) fn(it, dx, dy);
        }
      }
    }
  }
}
