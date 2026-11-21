# One-Prompt Trailer · project rules for Claude Code

> **Author:** Muhammad Akhtar Shamim · **Licence:** CC BY 4.0 (see LICENSE-MEDIA.md) · **Created:** 2026-11-21
>
> **What this file is:** The standing rules an AI assistant follows when it works in this repository: honesty, respect, copyright, code standard, build order.

This repository is a film engine and one sample film. From `scenes.json` and `src/`, `build.py` makes a single HTML
page (`docs/index.html`) that plays a short cinematic trailer: live 3D scenes (Three.js), a synthetic voiceover
(Kokoro), music composed in code (`score.py`) and titles. Read `README.md` for the tour and `PROMPT.md` for the brief
people start from.

When this folder sits inside someone's project as `trailer/`, that project is the film's subject: read it, never change
it, and write only inside this folder.

## Standing rules

1. **One scene at a time.** Build or change one scene, show a screenshot of every shot, and wait for the author's
   notes before starting the next. Never batch-build scenes nobody has seen.
2. **Honest content.** Every number shown or spoken is counted by a script from real files (see how `build.py` counts
   `facts`). No invented figures, no prices, no promises. A claim about a tool must be true of that tool; when unsure,
   leave it out. State what you did not check.
3. **Respect for people's work.** When the film compares itself with how things are usually done (a film crew,
   musicians, designers), show those people as skilled and valued. Say what this is for, never what it replaces.
4. **Copyright and plagiarism.** Use only material from the project being filmed or made new here. Copy nothing
   from anyone else: no text, code, picture, recording, sample, song, font, logo or character; and imitate no named
   artist, film, brand or real person. Do not reuse this repository's sample script for another project: write a new
   story. Music is synthesised here; images are painted on a canvas in `film.js`. An outside fact needs its source on
   screen or is left out. Check a library's licence before adding it, keep its notice, and list it in
   `THIRD-PARTY.md`. Do not write "copyright free" or promise ownership. Third-party names appear only in the closing
   credits, the page's disclosure notice and `THIRD-PARTY.md`. Finish with a rights list: every source in the film and where it came from.
5. **Say it is AI.** The page's notice says the voice is synthetic and the music generated. Keep it.
6. **Plain words.** Titles and spoken lines use words a newcomer understands. No jargon, no slogans.
7. **Questions.** One at a time; two to four options with the recommended one first and one line of why; wait for the
   answer. Before planning a new film, ask the questions listed in `PROMPT.md` (audience, message, language, what to
   deliver, length, shape, tone, look, limits, credits), skipping any the project already answers.
8. **Open to everyone.** Every spoken phrase is also shown as a caption and listed in the transcript; the player works
   from the keyboard; the film waits for a click when the viewer asks for reduced motion. Keep all of these.
9. **One file means one file.** The page loads nothing from any other site: no web fonts, no scripts, no tracking.
10. **Language.** The kit ships in English. Before offering another language, check that the voice tool has a voice
   for it and that the fonts cover its script, and say plainly when they do not.

## Code standard: clean, reusable, documented

Applies to every `.py`, `.js`, `.css` and `.html` file here.

- **Header on every file**, first thing after the shebang (a module docstring in Python, a leading comment elsewhere):
  title and one-line purpose; what it does, its inputs and outputs, how to run it; `Author:`; `Licence: MIT (see
  LICENSE)`; `Created: YYYY-MM-DD`. Documents (`.md`) say `CC BY 4.0 (see LICENSE-MEDIA.md)` instead: the code is MIT, the film,
  prompt and documents are CC BY 4.0. No change log in files: the history of changes lives in git.
- **Named functions with docstrings** (purpose, arguments, returns), and a `main()` behind
  `if __name__ == "__main__":` in scripts. One job per function.
- **Constants are named and sit at the top.** No magic numbers in the body, no dead code, no commented-out code.
- **Comments say why; names say what.**
- **Run it before calling it done:** `python3 -m py_compile` for Python, `node --check` for JavaScript, then the
  `trailer-verify` skill.

## How the film is built

```text
scenes.json ──► build.py ──► audio/voice_script.json ──► make_audio.py ──► audio/track.mp3
     ▲                                                        │
     └──────────── tighten.py ◄── audio/audio_facts.json ◄────┘
scenes.json + src/ + vendor/ + audio/track.mp3 ──► build.py ──► docs/index.html
```

- A scene is one entry in `scenes.json` plus one builder in `src/film.js` with the same `id`.
- A builder returns `{ group, update(u, t), cam or shots }`. `u` is the scene's story progress (0 to 1); `t` is the
  film clock in seconds. Every animation must be a pure function of `(u, t)` so that seeking works.
- Spoken lines are `beats`: `[story progress, phrase]`. `tighten.py` turns them into timed `cues` and a `warp`, so a
  picture always arrives on its word. After changing any words, run the build twice (the second pass uses the real
  phrase lengths).
- A new Three.js class must be added to `vendor/three-entry.js` and the bundle rebuilt (`vendor/build_three.js`).

## Skills and agents (under `.claude/`)

Skills: `trailer-build` (voice, music, tighten, page), `trailer-scene` (add or rework one scene), `trailer-verify`
(check the built page in a browser).
Agents: `scene-reviewer` (continuity, readability, framing of one scene), `claims-checker` (every word and number
against the rules above). Use them instead of re-deriving the workflow.
