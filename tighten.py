#!/usr/bin/env python3
"""Tighten the film: squeeze the silent gaps between spoken phrases without moving any picture off its word.

Every scene's animation is written against its "story progress" (0 to 1). This script keeps that progress as it is and
changes only how fast the film moves through it: between one cue and the next it allows just the time the phrase takes
(plus a breath), so slack disappears where there was slack and nothing changes where there was none. For each scene it
writes into scenes.json a new length, new cue times and a "warp" (pairs of [story progress, seconds into the scene])
that film.js uses to find the progress for any moment. The scene's present timing must already fit (run make_audio.py
first: this reads audio/audio_facts.json for the phrase lengths).

Run:  python3 tighten.py     then: python3 build.py ; python make_audio.py ; python3 build.py   (twice when lines are new)

Author:  Muhammad Akhtar Shamim
Licence: MIT (see LICENSE)
Created: 2026-11-21
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCENES = os.path.join(HERE, "scenes.json")
FACTS = os.path.join(HERE, "audio", "audio_facts.json")
BREATH = 0.35           # seconds kept after a phrase before the next one starts
FASTEST = 0.75          # no stretch of a scene runs in less than this share of the time it was written for
LEAD_IN = 0.5           # seconds from a cut to the first word
TAIL = 0.8              # seconds a scene holds after its last word
SOLO_TAIL = 1.5         # ... for a scene with one line and several pictures to show
SECONDS_PER_LETTER = 0.062   # for a phrase not yet recorded: a first guess, replaced by its real length on the next run


def spoken_seconds(phrase: str, measured: dict) -> float:
    """How long a phrase takes to say: its measured length, or an estimate from its letters when it is new."""
    return measured.get(phrase, 0.25 + len(phrase) * SECONDS_PER_LETTER)


def tighten(scene: dict, measured: dict) -> dict:
    """Return the scene with a new dur, and for a scene with `beats` its cues and warp.

    `beats` are the scene's phrases as [story progress, words]: where in the scene's animation each is said. The time
    from one beat to the next is what the phrase takes plus a breath, but never less than FASTEST of the story it covers.
    """
    beats = scene.get("beats")
    if not beats:
        return dict(scene, dur=math.ceil(LEAD_IN + spoken_seconds(scene["say"], measured) + SOLO_TAIL))
    story = scene.get("story", scene["dur"])                    # the seconds the scene's animation was written for
    knots, clock, cues = [[0.0, 0.0]], LEAD_IN, []
    for k, (at, phrase) in enumerate(beats):
        knots.append([at, round(clock, 2)])
        cues.append([round(clock, 2), phrase])
        until = beats[k + 1][0] if k + 1 < len(beats) else 1.0
        wanted = spoken_seconds(phrase, measured) + (BREATH if k + 1 < len(beats) else TAIL)
        clock += max(wanted, (until - at) * story * FASTEST)
    new = math.ceil(clock)
    knots.append([1.0, float(new)])
    return dict(scene, dur=new, cues=cues, warp=knots, story=story)


def main() -> int:
    """Tighten every scene, print the before and after, and rewrite scenes.json."""
    cfg = json.load(open(SCENES, encoding="utf-8"))
    measured = {c["text"]: c["seconds"] for c in json.load(open(FACTS, encoding="utf-8"))["clips"]}
    before = sum(s["dur"] for s in cfg["scenes"])
    scenes = [tighten({k: v for k, v in s.items() if k not in ("warp", "cues")}, measured) for s in cfg["scenes"]]
    for old, new in zip(cfg["scenes"], scenes):
        print(f"  {old['id']:9s} {old['dur']:3d} s -> {new['dur']:3d} s")
    print(f"  total     {before:3d} s -> {sum(s['dur'] for s in scenes):3d} s")
    top = {k: v for k, v in cfg.items() if k != "scenes"}
    body = json.dumps(top, ensure_ascii=False, indent=1)[:-2] + ',\n "scenes": [\n' + ",\n".join("  " + json.dumps(s, ensure_ascii=False) for s in scenes) + "\n ]\n}\n"
    json.loads(body)
    with open(SCENES, "w", encoding="utf-8") as f:
        f.write(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
