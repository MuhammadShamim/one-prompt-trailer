# Rights and provenance

> **Author:** Muhammad Akhtar Shamim · **Licence:** CC BY 4.0 (see LICENSE-MEDIA.md) · **Created:** 2026-11-21
>
> **What this file is:** Where every part of the delivered film, video, poster and preview came from, who made it, and
> under what terms it is shared.

**This is a record of facts, not legal advice, and nobody qualified has reviewed it.** The terms for a synthetic
voice and for other AI-made material are not settled everywhere. Before you distribute the sample, or a film you make
with this kit, commercially, have someone qualified check it for your case and your country.

## What is delivered

| File | What it is | How it was made | Shared under |
|---|---|---|---|
| `docs/index.html` | The sample film as one web page | Built by `build.py` from this repository only | The film: CC BY 4.0. The code inside it: MIT. The Three.js bundle inside it stays MIT under its own notice |
| `assets/trailer.mp4` | The same film as a video | Recorded frame by frame from `docs/index.html` by `make_video.js`, joined to `audio/track.mp3` | CC BY 4.0 |
| `assets/trailer.srt` | Subtitles for the video | Written by `build.py` from the spoken lines in `scenes.json` | CC BY 4.0 |
| `assets/poster.png` | The poster | Six frames captured from `docs/index.html` by `make_poster.py`, laid out with text | CC BY 4.0 |
| `assets/preview.gif` | A short silent preview | Cut from `assets/trailer.mp4` by `make_video.js` | CC BY 4.0 |
| `audio/track.mp3` | The film's sound | Mixed by `make_audio.py`: a synthetic voice over music synthesised in `score.py` | CC BY 4.0 |

## Shapes and what was checked

| Output | Size | In this repository? | Checked |
|---|---|---|---|
| Web page | Fits the window | Yes, `docs/index.html` | Loaded in a browser; captions, the CC button and seeking spot-checked; not watched end to end with sound |
| Wide video | 1280×720, 24 frames a second | Yes, `assets/trailer.mp4` | Recorded in full; frames and file details spot-checked |
| Tall video | 720×1280 | No (made with `make_video.js --width 720 --height 1280`) | Recorded in full once; one frame from each of the 12 scenes looked at. Subjects and captions stay in frame; some side labels are cropped and the closing credits are small |
| Square or other sizes | Any | No | Not tried |
| Other languages or voices | See the README | No | Not built; only English with the voice `af_bella` |

## Where each kind of content came from

| Content | Source | Notes |
|---|---|---|
| Story, on-screen words, spoken lines | Written for this project (`scenes.json`) | Original. No text is taken from another work. |
| 3D people, rooms, props, city | Built from basic shapes in `src/film.js` | Original. No models, scans or photographs are used. |
| Pictures on surfaces (screens, book spines, faces, wood, sky) | Painted on a canvas by code in `src/film.js` | Original. The on-screen "projects" and their numbers are invented props. |
| Music | Synthesised note by note in `score.py` | Instrumental. No sample, loop, recording or existing melody is used. |
| Voice | Generated on the author's computer with Kokoro-82M | A synthetic voice, not a recording of a person. See below. |
| Typefaces | The viewer's own system fonts | No font files are included or downloaded. |
| 3D engine | Three.js 0.180.0 (`vendor/three.min.js`) | Third-party, MIT, notice kept at the top of the bundle. |

## The synthetic voice

- **Tool:** [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M). Its model card states the licence as Apache 2.0.
- **What its makers say about training:** the model card says it was trained on permissive or non-copyrighted audio.
  That is their statement; this project has not verified it and cannot.
- **What this project does:** it uses a stock voice of that model (`af_bella`), does not clone or imitate any real
  person, and says on the page and in the video file that the voice is synthetic.
- **What is not known:** the model card does not set out separate terms for audio generated with the model. Read the
  card and its licence yourself before relying on the output commercially.

## What this project's licences do and do not cover

- **MIT ([`LICENSE`](LICENSE)) covers** this project's own code.
- **CC BY 4.0 ([`LICENSE-MEDIA.md`](LICENSE-MEDIA.md)) covers** the sample film in every form listed above, the
  poster, the prompt and the documents. Anyone sharing or adapting them credits the author.
- **Neither covers** third-party components, which keep their own licences (see [`THIRD-PARTY.md`](THIRD-PARTY.md)), and
  the names of the tools credited in the film, which belong to their owners.

## Exclusions

No client, employer or personal data, no stock media, no logos and no third-party artwork were used.
