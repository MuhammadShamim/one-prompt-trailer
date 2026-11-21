#!/usr/bin/env python3
"""Make the film's sound: a Kokoro voiceover and a score composed in code, mixed into audio/track.mp3.

What it does:
  - reads audio/voice_script.json (written by build.py: every scene's start, length and spoken line, or its cues);
  - composes the score with score.py; that score is laid out by twelve named sections, so SECTION maps this film's
    scenes onto them;
  - speaks each line, or each cued phrase at its own time, with an energetic voice (VOICE, a little slower than neutral by PACE; --voice, --lang and --pace change them);
  - checks every phrase fits before the next one, ducks the music under the voice, soft-limits and encodes the mix;
  - writes audio/track.mp3 and audio/audio_facts.json (each phrase's start, length and whether it fits).
Run:   python make_audio.py [--voice af_bella] [--lang en]     (inside the virtual environment, see README)
       then: python3 build.py

Author:  Muhammad Akhtar Shamim
Licence: MIT (see LICENSE)
Created: 2026-11-21
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)        # so score.py is found however this script is started
import score as ma  # noqa: E402  the instruments, the composer, the speaker and the mixing helpers

OUT_DIR = os.path.join(HERE, "audio")
VOICE = "af_bella"                    # the default voice: Kokoro's most animated American female voice
LANGUAGE = "en"                       # the language used when scenes.json names none, a key of score.LANG_CODE
PACE = 0.92                           # the default pace: a little slower than neutral, so every word has room; above 1 is faster
PACE_RANGE = (0.7, 1.4)               # slower or faster than this and the voice stops sounding natural
CUE_GAP = 0.15                        # silence kept between one cued phrase and the next
MUSIC_UNDER = 0.7                     # the music's level in the mix, before the limiter
# this film's scene -> the section of score.py's score it plays
SECTION = {"night": "open", "ship": "company", "ignored": "p1", "wall": "p2", "spark": "p3", "script": "p4", "live3d": "p5",
           "voice": "p6", "score": "p7", "onefile": "p8", "premiere": "p9", "close": "close"}


def paced_speaker(neutral, pace: float):
    """Wrap score.py's speaker factory `neutral` so every line is spoken `pace` times faster.

    Returns a factory with the same call as score.speaker: (voice, lang_code) -> speak(text, speed).
    """
    def factory(voice: str, lang_code: str):
        speak = neutral(voice, lang_code)

        def speak_paced(text: str, speed: float):
            return speak(text, round(speed * pace, 2))

        return speak_paced

    return factory


def film_language() -> str:
    """The language scenes.json says the lines are written in, or LANGUAGE when it names none."""
    with open(os.path.join(HERE, "scenes.json"), encoding="utf-8") as f:
        return json.load(f).get("language", LANGUAGE)


def pace_value(text: str) -> float:
    """Read --pace: a number inside PACE_RANGE, or an argparse error naming the range."""
    pace = float(text)
    if not PACE_RANGE[0] <= pace <= PACE_RANGE[1]:
        raise argparse.ArgumentTypeError(f"pace must be between {PACE_RANGE[0]} and {PACE_RANGE[1]}")
    return pace


def spoken_plan(plan: list) -> list:
    """The plan as the speaker needs it: a scene with `cues` becomes one entry per phrase, placed at its own time.

    Each entry starts VOICE_OFFSET early because the speaker adds that offset, and lasts until the next cue (or the scene's end).
    """
    out = []
    for scene in plan:
        cues = scene.get("cues")
        if not cues:
            out.append(scene)
            continue
        for k, (at, phrase) in enumerate(cues):
            until = cues[k + 1][0] if k + 1 < len(cues) else scene["dur"]
            out.append({"id": f"{scene['id']}.{k + 1}", "start": scene["start"] + at - ma.VOICE_OFFSET,
                        "dur": until - at - CUE_GAP + ma.VOICE_OFFSET + ma.VOICE_END_MARGIN, "text": phrase})
    return out


def main() -> int:
    """Compose, speak, mix and encode; exit 1 when a line does not fit its scene."""
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--voice", default=VOICE, help=f"a Kokoro voice id (default {VOICE})")
    ap.add_argument("--lang", default=film_language(), choices=sorted(ma.LANG_CODE),
                    help="the language of the lines (default: \"language\" in scenes.json)")
    ap.add_argument("--pace", type=pace_value, default=PACE,
                    help=f"how fast the lines are spoken, 1.0 is neutral (default {PACE}, from {PACE_RANGE[0]} to {PACE_RANGE[1]})")
    args = ap.parse_args()
    script_path = os.path.join(OUT_DIR, "voice_script.json")
    with open(script_path, "rb") as f:
        raw = f.read()
    script = json.loads(raw)
    total = float(script["total"])
    plan = [dict(s, id=SECTION[s["id"]]) for s in script["scenes"]]
    print("composing the score")
    buses, kick_env = ma.compose(plan, total)
    music = ma.mix_music(buses, kick_env)
    music /= np.max(np.abs(music)) + 1e-9
    print("speaking the lines with", args.voice, "in", args.lang, "at pace", args.pace)
    ma.speaker = paced_speaker(ma.speaker, args.pace)
    voice, clips = ma.render_voice(spoken_plan(plan), total, args.voice, ma.LANG_CODE[args.lang])
    # score.py records the speed it asked for; the voice was really spoken that many times the pace
    for clip in clips:
        clip["spoken_speed"] = round(clip["speed"] * args.pace, 2)
    music = ma.duck_under_voice(music, voice)
    mix = music * MUSIC_UNDER + voice[:, None] * ma.GAIN["voice"]
    mix = np.tanh(mix * 1.15) / np.tanh(1.15)
    mix *= 0.95 / (np.max(np.abs(mix)) + 1e-9)
    wav, mp3 = os.path.join(OUT_DIR, "track.wav"), os.path.join(OUT_DIR, "track.mp3")
    sf.write(wav, mix.astype(np.float32), ma.SR)
    import imageio_ffmpeg
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-b:a", f"{ma.MP3_KBPS}k", mp3], check=True)
    os.remove(wav)
    speaking = ma.speech_gate(voice) > 0.5
    ratio = round(ma.dbfs(voice[speaking]) - ma.dbfs(music[speaking].mean(axis=1)), 1)
    # script_sha256 ties this track to the exact script it was made from; build.py refuses to embed a track that no longer matches
    facts = {"seconds": total, "mp3_bytes": os.path.getsize(mp3), "voice": args.voice, "language": args.lang, "pace": args.pace,
             "script_sha256": hashlib.sha256(raw).hexdigest(), "clips": clips, "voice_over_music_db": ratio, "all_fit": all(c["fits"] for c in clips)}
    json.dump(facts, open(os.path.join(OUT_DIR, "audio_facts.json"), "w", encoding="utf-8"), indent=1)
    print(f"wrote track.mp3  {facts['mp3_bytes'] / 1024:.0f} KB  voice over music {ratio} dB  all fit {facts['all_fit']}")
    return 0 if facts["all_fit"] else 1


if __name__ == "__main__":
    sys.exit(main())
