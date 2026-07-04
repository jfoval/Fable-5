# Star-Spangled Skies 🎆

A free, one-file 3D fireworks game celebrating **America's 250th birthday** (July 4, 1776 → July 4, 2026).

Tap anywhere in the sky to launch a firework over the harbor. Pop the drifting
**gold stars (25)**, **red/white/blue balloons (10)**, and the mighty
**bald eagle (76!)**. Blast several targets at once for a combo multiplier.
You get **76 seconds** — can you score **250**?

## Play / host it

Everything lives in this `docs/` folder: `index.html` plus a vendored copy of
Three.js (r128, MIT). No build step, no server code, no external requests.

**Host free on GitHub Pages:** repo **Settings → Pages → Deploy from a branch**,
pick this branch and the `/docs` folder, save. Your game goes live at
`https://<user>.github.io/<repo>/`.

Or run locally: `python3 -m http.server -d docs` and open http://localhost:8000.

## Notes

- Works on desktop and phone (pointer + touch), sound is synthesized with
  WebAudio — no audio assets.
- `?t=NN` query param shortens the round length for quick testing.
- Best score is stored in `localStorage`.

MIT license. Happy Fourth! 🇺🇸

## Credits

- Bird model: `Parrot.glb` from the [three.js examples](https://github.com/mrdoob/three.js) (by mirada, from ro.me), repainted in-engine as a bald eagle.
