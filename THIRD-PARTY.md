# Third-party components

> **Author:** Muhammad Akhtar Shamim · **Licence:** CC BY 4.0 (see LICENSE-MEDIA.md) · **Created:** 2026-11-21
>
> **What this file is:** Every part of this project that belongs to someone else, what it is used for, its licence, and whether it is included here.

This project's own code is MIT (`LICENSE`); its film, poster, prompt and documents are CC BY 4.0 (`LICENSE-MEDIA.md`). The parts below belong to other
people and keep their own licences.

| Component | Used for | Licence | In this repo? |
|---|---|---|---|
| [Three.js](https://threejs.org) 0.180.0 | Drawing the 3D scenes | [MIT](https://github.com/mrdoob/three.js/blob/dev/LICENSE) | Yes: `vendor/three.min.js`, a tree-shaken bundle with its notice at the top. It is also inlined into `docs/index.html`. |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) | The spoken voice | Apache 2.0, as stated on its [model card](https://huggingface.co/hexgrad/Kokoro-82M) | No. It is downloaded on first use. The film contains audio generated with it. |
| [espeak-ng](https://github.com/espeak-ng/espeak-ng) | Turning words into sounds for Kokoro | [GPL 3.0](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING) | No. It is a tool you install; nothing of it is in the film. |
| NumPy, SciPy, SoundFile, PyTorch | Synthesising and mixing the music; running the voice model | BSD-style | No. Installed from `requirements.txt`. |
| [FFmpeg](https://ffmpeg.org/legal.html), through `imageio-ffmpeg` | Encoding the sound and the video | LGPL or GPL (FFmpeg), BSD (wrapper) | No. Installed from `requirements.txt`. |

**Typefaces:** none are included or downloaded. The film uses the fonts already on the viewer's device, and the page
makes no request to any other site.

**This project as a whole is not under one licence.** Its own code is MIT and its own film and documents are CC BY 4.0; each component above keeps its own licence, and
you must meet those terms when you install and run them. [`RIGHTS.md`](RIGHTS.md) records where every delivered file
came from.

## About the sound

- **The voice** is synthetic. It was generated on the author's computer with Kokoro-82M. Its model card states an
  Apache 2.0 licence and says it was trained on permissive or non-copyrighted audio; that is its makers' statement,
  not something this project has verified. This is not legal advice: check the terms for your own use.
- **The music** is synthesised note by note in `score.py`. No recording, sample, loop or existing song is used.

## About names

Claude Code, Three.js, Kokoro, Python, NumPy and FFmpeg are named in the film's credits to say what it was made with.
Those names belong to their owners. This project is not affiliated with or endorsed by any of them.
