---
name: trailer-build
description: Build the whole film (voice, music, tightened timing, the page) from scenes.json and src/. Use after any change to a spoken line, a scene's length, the music, or src/, and before verifying.
---

> **Author:** Muhammad Akhtar Shamim · **Licence:** CC BY 4.0 (see LICENSE-MEDIA.md) · **Created:** 2026-11-21
>
> **What this file is:** A skill: the commands, in order, that turn scenes.json and src/ into the finished film, and what to do when one fails.

# Build the film

All commands run from the repository root. `python` means the virtual environment that has `requirements.txt`
installed; `python3` can be the system one.

## 1. Check the code parses

```bash
node --check src/film.js
python3 -m py_compile build.py make_audio.py score.py tighten.py
```

## 2. Voice, music and timing

Run the loop **twice** when any spoken words changed. The first pass times new phrases by an estimate; the second
uses their real recorded length.

```bash
python3 tighten.py        # scenes.json: beats -> cues, warp, each scene's length
python3 build.py          # writes audio/voice_script.json
python make_audio.py      # writes audio/track.mp3 and audio/audio_facts.json
```

`make_audio.py` prints one line per phrase. The run is good only when it ends with `all fit True`. A phrase marked
`TOO LONG` must be shortened in `scenes.json` (do not raise the speaking speed).

## 3. The page

```bash
python3 build.py          # writes docs/index.html with the track embedded
```

It prints the page's size, the number of scenes and the film's length in seconds. Those numbers also appear inside
the film, counted by this script.

## 4. Then

Run the `trailer-verify` skill. Report the film's length and anything not checked.

## When something fails

- `unresolved placeholders`: a `[[NAME]]` in `src/template.html` has no value in `build.py`.
- `KeyError` in `make_audio.py`: a scene id in `scenes.json` is missing from `SECTION`, which maps each scene to a
  section of the score.
- No sound in the page: `audio/track.mp3` did not exist when `build.py` ran; run it again after `make_audio.py`.
