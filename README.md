# The Shire — a walk

A first-person, freely walkable recreation of the Shire from *The Lord of the Rings*,
built after the films of Peter Jackson. Walk from Bag End's green door down the lane,
past the Party Tree with its lanterns still hanging, along the Great West Road, and
along the Water past the Mill to Bywater. Then stand still and let the sun go down.

Everything you see is generated in the browser at load time. There are no image files,
no models, no audio files and no build step — the whole county is about twelve thousand
lines of JavaScript and a single `<canvas>`.

## Running it

Any static server will do:

```bash
python -m http.server 8000     # then open http://localhost:8000
# or
npx serve .
```

`file://` will not work: ES modules and the import map both need a real origin.

### Deployment

Serve from the repository root, with `index.html` at the root. GitHub Pages does this by
default; nothing else is required. There is no `package.json`, no bundler, and no
build artefact to produce.

## Controls

| | |
|---|---|
| `W A S D` / arrows | walk |
| `Shift` | run |
| mouse | look |
| wheel | pace yourself |
| `E` | look closer at a thing |
| `M` | the map of the Four Farthings |
| `P` | photo mode — hides the interface and letterboxes the frame |
| `N` | silence the country |
| `T` | skip ahead an hour |
| `1` `2` `3` | detail: low, medium, high |
| `F` | frame statistics |
| `H` / `Esc` | help / close |

**On a phone:** left thumb to walk, right thumb to look, and the four buttons for
run, look, map and help. The interface reflows, the device pixel ratio is capped, and
the whole scene is built at a lower resolution to start with.

## What is deliberate, and why

The films' Shire is a very specific place, and the details that make it recognisable are
mostly small ones. All of them are here on purpose.

- **The doors are round, and small.** A hobbit door is 1.1 m across, which means it is
  about two thirds of your own height. The player is 1.68 m at the eye; a hobbit would
  come up to your chest. Every door in the county is 1.1 m, set slightly proud of the
  wall, on a stone surround, with a brass knocker in the exact centre — which is what
  the camera pushes in on in the first shot of *Fellowship of the Ring*.
- **Bag End is in the Hill, not beside it.** It is 15.5 m of frontage buried in the
  flank of The Hill, faced in pale render, with a turf roof that is the *same shader and
  the same field texture* as the hillside behind it. There is no seam where the grass
  stops and the grass starts again.
- **The windows are portholes.** Round, with a cross of mullions, glowing warm from
  inside, set in a stone ring with a sill. Bag End has a whole row of them. They are the
  thing you see first, at dusk, from down the lane.
- **Chimneys smoke.** Every hole in the county has one, and the smoke is a column of
  soft billboards that leans downwind and dissolves.
- **The Party Tree is the anchor.** It is bigger than any other tree by a factor of
  more than two, it stands in an open field at the foot of the Hill, and it has
  forty-six lanterns hung on strings in it. Press `E` and look up.
- **The Water is a river, not a ribbon.** It is a meandering spline with a falling
  surface level, and the terrain is carved to match — banks, a bed, a mill race. The
  mill's wheel turns because the Water turns it.
- **The Great West Road is a dirt track with ruts**, and the lanes to Bag End, the Mill
  and Bywater are narrower and less trodden.
- **The Fields are a patchwork** — barley, wheat, kale, turnips, each a different green
  or gold, each bounded by drystone or hedge, east of Hobbiton where the land is flat.
- **The orchard is planted in rows.** Sam's rowan is by Bag End's gate.
- **The Misty Mountains are north, and blue.** So is the eastern treeline, the edge of
  the Old Forest, and if you walk into it after dark there are lights in the trees.
- **Nothing is in a hurry.** There is no objective, no timer, no score. You can find all
  fifteen places or none of them; the walk keeps your discoveries in the browser and
  does not mind.

## The look

Realistic, lit like a dream.

- A full 24-hour cycle in eight minutes, from keyframed colour and intensity curves
  rather than a lerp between two presets. Dawn and dusk get their own keys: a low orange
  sun, a compressed band of colour on the horizon, long shadows, and a long way of light
  laid along the Water.
- One shadow-mapped sun whose frustum follows you, a hemisphere light for sky and grass
  bounce, a fill light, ACES filmic tone mapping, and a colour grade with warm
  highlights, cool shadows, a vignette, a whisper of chromatic aberration and film grain.
- Ground mist that samples the height field in its own vertex shader, so it pools in the
  hollows and slides off the rises instead of floating in a flat slab.
- Baked horizon occlusion on the terrain, so the hollows are soft and the rises catch the
  light.
- Radial god rays from the sun's position on screen, strongest when it is low.
- Fireflies after dusk, pollen and dust in the daytime light shafts, butterflies by day
  and moths at night, swifts and thrushes overhead, and a sun pillar on the horizon.

All of it is procedural. The terrain, the trees (eight species, generated and merged
once, then instanced), every texture, every sound.

## Architecture

No dependencies to install. Three.js `0.169.0` arrives from unpkg through the import
map in `index.html`.

| module | what it does |
|---|---|
| `src/main.js` | boots everything, owns the frame loop, the interaction and the toasts |
| `src/constants.js` | the shape of the Shire: rivers, roads, landmarks, quality tiers |
| `src/noise.js` | the height field, masks, and the `Field` grid every other module reads |
| `src/textures.js` | every texture in the county, drawn into canvases at load time |
| `src/terrain.js` | the ground splat shader, the far ring, and the mountain ranges |
| `src/water.js` | the Water and its tributary, as swept ribbons with a hand-written shader |
| `src/sky.js` | the dome, sun, moon, stars, clouds, and the three lights |
| `src/vegetation.js` | the player-following grass field, and the eight tree species |
| `src/locations.js` | the plan of the villages, discovery, and the things you can press `E` on |
| `src/buildings.js` | Bag End, the hobbit holes, the Green Dragon, the Mill, the lanterns |
| `src/props.js` | walls, hedges, the well, the bridge, the signpost, carts, hay, the windmill |
| `src/creatures.js` | fireflies, pollen, butterflies, moths, birds, smoke, mist |
| `src/player.js` | walking, sliding off slopes, collision, wading, the head bob |
| `src/audio.js` | wind, birds, an owl, the Water, crickets, footsteps and bells, synthesised |
| `src/postfx.js` | god rays, bloom, tone map, grade, FXAA |
| `src/ui.js` | HUD, toasts, the map, the help card, the phone's two thumbs |
| `src/save.js` | a very small, very polite local store |

### Two ideas worth explaining

**One field, shared by everybody.** `src/noise.js` bakes a 512² grid of height, grass
density, crop, road, wetness, water depth and horizon occlusion. The terrain mesh, the
grass vertex shader, tree scatter, the player's feet and the water's edge all read that
one grid. Nothing can ever disagree about where the ground is.

**Grass that costs nothing.** The grass is a fixed set of instanced blades on a lattice.
In the vertex shader each blade wraps to the cell nearest the camera, samples the field
texture for its ground height and for how much grass grows there, and collapses to
nothing where there is road, water or crop. Move the player and the whole meadow moves
with them, at zero CPU cost, with no rebuild and no popping.

## Checks

```bash
node tools/check.mjs
```

Eight groups: every module parses, the import map pins the right version, relative
imports resolve, bare imports are only `three` and the allowed addons, the HTML is wired
up, no binary assets exist or are referenced, every file in scope is present and
non-empty, and the console stays quiet.

## Licence and thanks

An homage, built from nothing but a love of the films. *The Lord of the Rings* and the
Shire are the creations of J.R.R. Tolkien; the Shire as it appears on screen is the work
of Peter Jackson, the cast and crew, and the many artists who built it. This is not an
official work, and it is not affiliated with anyone. The Shire belongs to its author; this
is a small, affectionate thing made for a walk on a wet afternoon.
