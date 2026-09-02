# Formula 0.1

Low-poly arcade F1 racing in the browser. Three.js + vanilla JS, no build step,
no backend, no accounts. Everything persists in `localStorage`.

## Run

ES modules will not load over `file://`, so serve the folder:

    serve.cmd            (or: python -m http.server 8080)

then open <http://localhost:8080>.

## Controls

| | |
|---|---|
| `W` / `↑` | throttle |
| `S` / `↓` | brake, then reverse |
| `A` `D` / `←` `→` | steer |
| `R` | reset to the racing line (invalidates the lap) |
| `Esc` | pause |

## Modes

**Time Trial** — team → circuit → drive. Best lap per circuit is saved, and the
bottom-centre panel shows Record / Current / Difference with a live delta against
your personal best (green = up on it, red = down).

The racing line is speed-reactive, the way the F1 games do it: **green** where you
have room to accelerate, **amber** where the corner ahead will not take much more
than you are already carrying, **red** once you are past the point where you could
still slow down for it. A minimap top-right shows the circuit and every car on it.

**Grand Prix** — team → circuit → 3/5/10 laps → Easy/Medium/Hard, then
Free Practice (skippable) → Qualifying → lights out → race → results → podium.

Qualifying is one flying lap. A translucent ghost drives whichever lap is
currently fastest and re-targets live when an AI beats it. The grid is set by
lap time, you included. Touch the throttle before the lights go out and you get
a jump start: you go, but with +5s on your race time.

## Layout

    index.html
    css/style.css
    assets/audio/music.mp3      background music (the file that was already here)
    js/
      main.js       renderer, input, screen flow
      session.js    one driving session: phases, timing, classification, camera
      track.js      spline -> centreline, racing line, road/kerb/barrier meshes
      tracks.js     the seven circuit layouts (control points + per-track tuning)
      car.js        shared physics parameters + the car model
      ai.js         pure-pursuit AI driver, difficulty pace, lap-time estimator
      scenery.js    per-theme low-poly props, grandstands, start lights
      podium.js     the top-three celebration scene
      audio.js      procedural Web Audio engine + music
      ui.js         menus, results tables, HUD writes
      storage.js    localStorage
      vendor/       three.js r160

## Notes on the design

- **Team choice is cosmetic.** Every car on the grid — player and AI — runs the
  identical parameter block in `car.js`. Only `DIFFICULTY.pace` in `ai.js`
  changes anyone's speed, and it is applied uniformly with no rubber-banding.
- **The circuits are real, at 1:1.** `js/tracks.js` is generated from surveyed
  centrelines, not drawn by hand: OpenStreetMap traces (via
  [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits), **ODbL**)
  projected to local metres, with elevation sampled from SRTM 30m via
  [opentopodata.org](https://www.opentopodata.org/) and then smoothed and
  gradient-limited — SRTM is terrain data, not a road survey. Every lap length
  lands within 0.25% of the official figure and Spa carries its real 101m of
  elevation. Node 0 of each trace is the start/finish line. Point spacing is
  adaptive (Ramer–Douglas–Peucker), so hairpins are dense and straights are sparse
  — all seven circuits fit in 20 KB.
- **Lap times are calibrated against reality.** With the geometry at true scale the
  car needed a real F1 envelope: ~345 km/h, 5.6g braking, and grip that rises with
  speed (`aeroGrip`) because downforce is why Silverstone and Spa are so much faster
  than their corner radii suggest. The Hard AI now laps within **2.6% of real pole
  time** on average (Monza +0.3%, Red Bull Ring +1.0%, Monaco −4.8%); Medium is
  +6.3% and Easy +13.8%.
- **Handedness is enforced, not hoped for.** Three.js is right-handed, so with the
  car driving toward +z it is world **-x** that lies to the driver's right. Getting
  that backwards inverts the steering *and* mirrors every circuit. Each track now
  declares its real direction of travel as `dir`, and `track.js` mirrors x to match,
  so a layout can never silently come out reversed.
- **The terrain follows the circuit's own topography.** The apron beside the track
  eases onto a heavily smoothed version of the track's *own* elevation, not onto one
  flat plane. Easing to a global minimum is what turns a circuit with 100m of
  elevation into a plateau ringed by 40-degree cliffs.
- **The terrain also knows how much room it has.** `computeTerrainReach()` measures, per
  centreline sample, the distance to the nearest far-arc part of the lap and caps the
  apron at 0.45 of the gap. Without it, Monaco's Casino section — 33m above the tunnel
  run and 3m from it in plan — spreads its apron over the road below and the car ends
  up driving under the ground. The same function grounds every tree and building, so
  nothing floats.
- **The AI drives on a real margin.** `GRIP_MARGIN`/`BRAKE_MARGIN` in `ai.js` keep
  it inside the car's actual envelope — a lookahead driver aiming for 100% just
  runs wide. `estimateLapTime` is calibrated against the same simulation, so
  qualifying times match race pace.
- No tyre wear, no fuel, no pit stops, no damage, no networking. By design.

## Licence

Code is MIT. The circuit geometry in `js/tracks.js` is derived from OpenStreetMap
and is **ODbL** — see [LICENSE](LICENSE) for the full attribution, including
three.js and the SRTM elevation source.
