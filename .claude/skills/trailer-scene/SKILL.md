---
name: trailer-scene
description: Add a new scene to the film or rework an existing one, the way the author expects it done (people and real objects, several camera angles, words tied to pictures). Use for any request about one scene's picture, words or timing.
---

> **Author:** Muhammad Akhtar Shamim · **Licence:** CC BY 4.0 (see LICENSE-MEDIA.md) · **Created:** 2026-11-21
>
> **What this file is:** A skill: how to add or rework one scene, from the data in scenes.json to the builder in src/film.js, and the standards each scene must meet.

# Add or rework one scene

Work on **one scene**, then stop and show it. Never start the next scene until the author has seen this one.

## 1. Decide what the scene says

Write one sentence for what the viewer should understand. Then list, in order, what they **see** and what they
**hear**. If the two do not match line for line, fix the plan before writing code.

## 2. The data: `scenes.json`

Each scene is one object:

| Key | Meaning |
|---|---|
| `id` | The name of its builder in `src/film.js` (`builders.<id>`) |
| `colour`, `deep` | Its light and dark colour (titles, glow, the chapter on the scrubber) |
| `kicker`, `title`, `line` | The three lines of text on screen |
| `say` | Everything spoken, as one string |
| `beats` | `[[story progress, "phrase"], ...]`: each spoken phrase and where in the scene it belongs (0 to 1) |
| `story` | The seconds the scene's animation was written for; `tighten.py` shortens from there |

A new scene id must also be added to `SECTION` in `make_audio.py`.

## 3. The picture: a builder in `src/film.js`

```js
builders.myScene = function (sc) {
  var g = new THREE.Group();
  // build people, props and lights into g
  return {
    group: g,
    floor: false,            // true keeps the default stage floor
    day: true,               // outdoor or brightly lit: pale sky, strong fill light
    accent: 0,               // switch off the coloured stage light inside rooms
    shots: [                 // cuts inside the scene, each starting at progress `at`
      { at: 0,   from: [x, y, z], to: [x, y, z], look: [x, y, z] },
      { at: 0.5, from: [x, y, z], to: [x, y, z], look: [x, y, z], lookTo: [x, y, z] }
    ],
    update: function (u, t) { /* pose and move everything from u (0..1) and t (seconds) only */ }
  };
};
```

Rules the author has asked for, again and again:

- **People and real objects.** Use `person()`, `pose()`, `stride()`, `cheer()`, `deskSet()`, `officeRoom()`,
  `workshop()`, `laptopProp()`, `slab()` (phone or tablet), `monitor()`, `tag()`. Add new props in the same style.
- **Screens must be readable and face their user.** Paint them with `painted()` or a `liveScreen()`.
- **Continuity.** The same person, clothes and objects as the scene before. Nothing appears or vanishes on a cut.
- **Hands hold things properly.** Attach a held object to the hand and keep it rigid; see the mug in `builders.night`.
- **Several angles, always moving.** Three or four `shots`, and motion in each.
- **Bright enough to see faces**, and never so bright that a face bleaches.
- **Labels in rows that do not cross** (see `WAVE_UP` and `CLAIMS_UP`).
- **Name every number.** Positions and timings that matter go in named constants at the top of the section.

## 4. Build and look

Run the `trailer-build` skill, then open the page and look at **every shot** of the scene (the `trailer-verify`
skill shows how to jump to a moment). Fix what you see before showing it.

## 5. Hand over

Give the author a table: each shot, what is seen, what is said. Then say what you did not check, and wait.
