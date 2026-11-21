#!/usr/bin/env python3
"""The film's sound, as a library: instruments and a score composed in code, and a synthesised voiceover.

What is in here:
  - oscillators, noise, filters and a small reverb (saw, square, sine, lowpass, reverb ...);
  - instruments built from them (kick, snare, hat, bass_note, pad_chord, arp_note, stab, impact, riser);
  - compose(plan, total): the score at 128 BPM in D minor, laid out by section (a drone opening, a pulse, the groove,
    lead stabs, a climb, a major close) with an impact on every cut; mix_music() balances its buses;
  - speaker(voice, lang_code) and render_voice(plan, total, voice, lang_code): each line spoken by Kokoro-82M
    (Apache 2.0, runs locally) through espeak-ng, placed just after its cut and checked to fit;
  - duck_under_voice(): the music steps back while a line is spoken.
Every sound is synthesised here; no recording, sample or third-party audio is used. The score is deterministic (seeded).
This module has no command line: make_audio.py drives it.

Author:  Muhammad Akhtar Shamim
Licence: MIT (see LICENSE)
Created: 2026-11-21
"""
import os

import numpy as np
import soundfile as sf
from scipy import signal
from scipy.ndimage import maximum_filter1d

# the languages Kokoro speaks, by the code its pipeline takes (Japanese and Chinese need extra packages: see Kokoro's notes)
LANG_CODE = {"en": "a", "en-gb": "b", "es": "e", "fr": "f", "hi": "h", "it": "i", "pt-br": "p", "ja": "j", "zh": "z"}
SR = 44100
BPM = 128
BEAT = 60.0 / BPM
BAR = 4 * BEAT
ROOT_HZ = 73.416                      # D2: the key is D minor
# espeak-ng turns words into sounds for Kokoro; these defaults are where Homebrew puts it on an Apple-silicon Mac
ESPEAK_LIB = os.environ.get("ESPEAK_LIB", "/opt/homebrew/lib/libespeak-ng.dylib")
ESPEAK_DATA = os.environ.get("ESPEAK_DATA", "/opt/homebrew/share/espeak-ng-data")
VOICE_OFFSET = 0.6                    # seconds after a cut before the line starts
VOICE_END_MARGIN = 0.25               # the line must end this long before the next cut
MAX_SPEED = 1.12                      # the most Kokoro is sped up to fit a scene; shorten the line instead of going faster
MP3_KBPS = 112
SEED = 9
# chords as semitones from D; pads voice them an octave or two up
CHORDS = {"Dm": [0, 3, 7], "Bb": [-4, 0, 3], "F": [3, 7, 10], "C": [-2, 2, 5], "Gm": [5, 8, 12], "A": [-5, -1, 2], "D": [0, 4, 7]}
PROGRESSION_A = ["Dm", "Bb", "F", "C"]          # the groove, two bars a chord
PROGRESSION_B = ["Dm", "Bb", "Gm", "A"]         # the tension from the fifth phase
CLIMB = ["Bb", "C", "Dm", "Dm"]                 # the ninth phase, one bar a chord
INTENSITY = {"open": 0, "company": 1, "p1": 2, "p2": 2, "p3": 2, "p4": 2, "p5": 3, "p6": 3, "p7": 3, "p8": 3, "p9": 4, "close": 5}
BIG_CUTS = {"company", "p5", "p9", "close"}     # the cuts that get the large impact and riser
GAIN = {"drums": 0.9, "bass": 0.5, "pad": 0.5, "arp": 0.65, "lead": 0.6, "fx": 0.75, "drone": 0.4, "reverb": 0.45, "voice": 1.0}
LIFT = {0: 0.6, 1: 0.7, 2: 0.85, 3: 1.0, 4: 1.12, 5: 1.0}       # how much louder the rhythm section gets with the scene intensity
DUCK_KICK = 0.5                       # how far the kick pushes the pads, bass and arp down
DUCK_VOICE = 0.78                     # how far the voice pushes the music down (about -13 dB while a line plays)

rng = np.random.default_rng(SEED)


# ---------- small synthesis helpers ----------
def hz(semi: float, octave: int = 0) -> float:
    """Frequency of a note given in semitones from D2, shifted by octaves."""
    return ROOT_HZ * 2 ** (semi / 12 + octave)


def n_of(seconds: float) -> int:
    """Samples in a number of seconds."""
    return int(round(seconds * SR))


def t_axis(n: int) -> np.ndarray:
    """Time in seconds for each of n samples."""
    return np.arange(n) / SR


def env_exp(n: int, tau: float) -> np.ndarray:
    """Exponential decay with time constant tau seconds."""
    return np.exp(-t_axis(n) / tau)


def env_lin(n: int, attack: float, release: float) -> np.ndarray:
    """Linear attack, hold, linear release over n samples."""
    e = np.ones(n)
    a, r = min(n, n_of(attack)), min(n, n_of(release))
    if a:
        e[:a] = np.linspace(0, 1, a)
    if r:
        e[n - r:] *= np.linspace(1, 0, r)
    return e


def saw(f: float, n: int, phase: float = 0.0) -> np.ndarray:
    """A naive sawtooth at f Hz (the buses low-pass it)."""
    return 2 * ((f * t_axis(n) + phase) % 1.0) - 1


def square(f: float, n: int) -> np.ndarray:
    """A square wave at f Hz."""
    return np.sign(np.sin(2 * np.pi * f * t_axis(n)) + 1e-9)


def sine(f: float, n: int) -> np.ndarray:
    """A sine at f Hz."""
    return np.sin(2 * np.pi * f * t_axis(n))


def sweep_sine(f0: float, f1: float, n: int, tau: float) -> np.ndarray:
    """A sine whose pitch glides exponentially from f0 to f1 with time constant tau (kicks, impacts)."""
    t = t_axis(n)
    f = f1 + (f0 - f1) * np.exp(-t / tau)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def noise(n: int) -> np.ndarray:
    """White noise in -1..1 from the seeded generator."""
    return rng.uniform(-1, 1, n)


def lowpass(x: np.ndarray, fc: float, order: int = 2) -> np.ndarray:
    """Butterworth low-pass at fc Hz."""
    sos = signal.butter(order, min(fc, SR * 0.47), "low", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def highpass(x: np.ndarray, fc: float, order: int = 2) -> np.ndarray:
    """Butterworth high-pass at fc Hz."""
    sos = signal.butter(order, max(fc, 20), "high", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def bandpass(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Butterworth band-pass between lo and hi Hz."""
    sos = signal.butter(2, [max(lo, 20), min(hi, SR * 0.47)], "band", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def sweep_bandpass(x: np.ndarray, lo0: float, lo1: float, width: float = 1.8) -> np.ndarray:
    """A band-pass whose centre glides geometrically from lo0 to lo1 over the signal, filtered in short blocks (risers)."""
    out = np.zeros_like(x)
    block = 1024
    blocks = max(1, len(x) // block)
    for b in range(blocks + 1):
        s, e = b * block, min(len(x), (b + 1) * block)
        if s >= e:
            break
        c = lo0 * (lo1 / lo0) ** (s / len(x))
        out[s:e] = bandpass(x[max(0, s - 2048):e], c / width, c * width)[-(e - s):]
    return out


def reverb(x: np.ndarray, size: float = 1.0) -> np.ndarray:
    """A Schroeder reverb (four combs, two all-passes) on a mono signal; `size` scales the delays."""
    combs = [1557, 1617, 1491, 1422]
    y = np.zeros(len(x))
    for d in combs:
        d = int(d * size)
        a = np.zeros(d + 1); a[0] = 1; a[d] = -0.84
        y += signal.lfilter([1.0], a, x)
    y /= len(combs)
    for d in (225, 556):
        a = np.zeros(d + 1); a[0] = 1; a[d] = -0.5
        b = np.zeros(d + 1); b[0] = -0.5; b[d] = 1
        y = signal.lfilter(b, a, y)
    return y


class Bus:
    """A stereo buffer that sounds are mixed into at a time, with a pan."""

    def __init__(self, seconds: float):
        """An empty stereo buffer of the given length."""
        self.n = n_of(seconds)
        self.buf = np.zeros((self.n, 2))

    def add(self, start: float, x: np.ndarray, gain: float = 1.0, pan: float = 0.0):
        """Mix x (mono with a pan, or stereo) in at start seconds, clipped to the buffer."""
        s = n_of(start)
        if s >= self.n or s < 0:
            return
        x = x[: self.n - s]
        if x.ndim == 1:
            left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
            self.buf[s:s + len(x), 0] += x * gain * left
            self.buf[s:s + len(x), 1] += x * gain * right
        else:
            self.buf[s:s + len(x)] += x * gain


# ---------- instruments ----------
def kick(gain: float = 1.0) -> np.ndarray:
    """A kick: a pitch-dropping sine with a click, soft-clipped."""
    n = n_of(0.5)
    body = sweep_sine(170, 46, n, 0.045) * env_exp(n, 0.17)
    click = lowpass(noise(n_of(0.006)), 4000) * 0.5
    body[: len(click)] += click
    return np.tanh(body * 1.6) * 0.85 * gain


def snare(gain: float = 1.0) -> np.ndarray:
    """A snare: band-passed noise over a short 192 Hz tone."""
    n = n_of(0.35)
    return (bandpass(noise(n), 1200, 7000) * env_exp(n, 0.07) * 0.9 + sine(192, n) * env_exp(n, 0.045) * 0.6) * gain


def hat(open_: bool = False, gain: float = 1.0) -> np.ndarray:
    """A hi-hat: high-passed noise, closed (short) or open (longer)."""
    n = n_of(0.5 if open_ else 0.08)
    return highpass(noise(n), 7000) * env_exp(n, 0.14 if open_ else 0.018) * 0.75 * gain


def crash(gain: float = 1.0) -> np.ndarray:
    """A crash: high-passed noise with a long decay."""
    n = n_of(3.0)
    return highpass(noise(n), 4500) * env_exp(n, 0.8) * 0.5 * gain


def impact(big: bool) -> np.ndarray:
    """A cut impact: a sub drop with a low-passed noise burst; the big one is longer and louder."""
    n = n_of(2.2 if big else 1.2)
    sub = sweep_sine(80 if big else 70, 34, n, 0.25) * env_exp(n, 0.55 if big else 0.3)
    burst = lowpass(noise(n), 1800) * env_exp(n, 0.16 if big else 0.1) * 0.8
    return np.tanh((sub + burst) * 1.4) * (1.0 if big else 0.65)


def riser(seconds: float, big: bool) -> np.ndarray:
    """A riser into a cut: noise swept upward with a rising sine, growing over its length."""
    n = n_of(seconds)
    ramp = (np.linspace(0, 1, n)) ** 2
    swept = sweep_bandpass(noise(n), 250, 6500) * ramp
    tone = sine(0, n) + sweep_sine(220, 880, n, seconds * 4) * ramp * 0.25
    return (swept * 0.9 + tone) * (0.55 if big else 0.38)


def bass_note(f: float, seconds: float, octave_up: bool = False) -> np.ndarray:
    """A short bass pulse: saw and square, low-passed."""
    n = n_of(seconds)
    f = f * (2 if octave_up else 1)
    x = saw(f, n) * 0.6 + square(f, n) * 0.4
    return lowpass(x, 380 if not octave_up else 700) * env_exp(n, 0.11) * 0.9


def pad_chord(chord: str, seconds: float, cutoff: float, decay: float = 0.0) -> np.ndarray:
    """Detuned saw unison on the chord tones an octave up plus the root two octaves up; stereo; release included."""
    n = n_of(seconds + 0.6)
    out = np.zeros((n, 2))
    tones = [hz(s, 1) for s in CHORDS[chord]] + [hz(CHORDS[chord][0], 2)]
    for f in tones:
        for k, det in enumerate((-0.004, 0.0, 0.004)):
            v = saw(f * (1 + det), n, phase=rng.uniform())
            out[:, 0] += v * (1.0 if k != 2 else 0.6)
            out[:, 1] += v * (1.0 if k != 0 else 0.6)
    out = lowpass(out, cutoff) / (len(tones) * 2.6)
    env = env_lin(n, 0.35, 0.6) if not decay else env_exp(n, decay)
    return out * env[:, None]


def arp_note(f: float, cutoff: float) -> np.ndarray:
    """One arpeggio note: square and saw, low-passed at cutoff, short decay."""
    n = n_of(0.22)
    return lowpass(square(f, n) * 0.5 + saw(f, n) * 0.5, cutoff) * env_exp(n, 0.08) * 0.8


def stab(chord: str, cutoff: float, seconds: float = 0.9) -> np.ndarray:
    """A lead stab: detuned saws on the chord's root and fifth two octaves up."""
    n = n_of(seconds)
    root, fifth = CHORDS[chord][0], CHORDS[chord][2]
    x = np.zeros(n)
    for f in (hz(root, 2), hz(fifth, 2), hz(root, 3)):
        for det in (-0.006, 0.0, 0.006):
            x += saw(f * (1 + det), n, phase=rng.uniform())
    return lowpass(x / 9, cutoff) * env_lin(n, 0.012, 0.0) * env_exp(n, 0.32)


# ---------- the score ----------
def chord_at(t: float, scenes: dict) -> str:
    """The chord sounding at time t: Dm before the company, the groove progression, the tension progression, the climb, then D."""
    if t >= scenes["close"]["start"]:
        return "D"
    if t >= scenes["p9"]["start"]:
        return CLIMB[int((t - scenes["p9"]["start"]) // BAR) % 4]
    if t < scenes["company"]["start"]:
        return "Dm"
    prog = PROGRESSION_B if t >= scenes["p5"]["start"] else PROGRESSION_A
    return prog[int((t - scenes["company"]["start"]) // (2 * BAR)) % 4]


def compose(plan: list, total: float) -> tuple:
    """Render the score into buses; returns (dict of buses, kick envelope for side-chaining)."""
    by_id = {s["id"]: s for s in plan}
    level_at = lambda t: next((INTENSITY[s["id"]] for s in reversed(plan) if t >= s["start"]), 0)
    buses = {k: Bus(total) for k in ("drums", "bass", "pad", "arp", "lead", "fx", "drone", "rev")}
    t_company, t_groove, t_snare = by_id["company"]["start"], by_id["p1"]["start"], by_id["p2"]["start"]
    t_lead, t_peak, t_close = by_id["p5"]["start"], by_id["p9"]["start"], by_id["close"]["start"]
    kick_env = np.zeros(n_of(total))

    # drone: the opening's low D, fading as the groove takes over
    n = n_of(t_groove + 3)
    drone = sine(hz(0, -1), n) * 0.7 + lowpass(saw(hz(0, 0), n), 180) * 0.5
    fade = np.minimum(1, t_axis(n) / 6.0) * np.clip((t_groove + 3 - t_axis(n)) / 3.0, 0, 1)
    buses["drone"].add(0, drone * fade, 1.0)

    # the beat grid
    t = t_company
    bar_index = 0
    while t < t_close:
        level = level_at(t)
        lift = LIFT[level]
        for beat in range(4):
            tb = t + beat * BEAT
            if tb >= t_close:
                break
            # kick: beats one and three for the company, every beat in the groove, eighths in the bar before the close
            if (level == 1 and beat in (0, 2)) or level >= 2:
                buses["drums"].add(tb, kick(), lift)
                k = env_exp(n_of(0.22), 0.09)
                s = n_of(tb); kick_env[s:s + len(k)] = np.maximum(kick_env[s:s + len(k)], k[: len(kick_env) - s])
                if level >= 4 and t_close - tb < BAR:
                    buses["drums"].add(tb + BEAT / 2, kick(0.8), lift)
            # snare: two and four from the second phase; rolls into the big cuts
            if tb >= t_snare and beat in (1, 3):
                buses["drums"].add(tb, snare(), 0.9 * lift)
                buses["rev"].add(tb, snare(), 0.35)
            # hats: ticks for the company, sixteenths in the groove, an open hat on the and of four from the fifth phase
            for sub in range(4):
                ts = tb + sub * BEAT / 4
                if level == 1 and sub in (0, 2):
                    buses["drums"].add(ts, hat(False, 0.45), lift, pan=0.3)
                elif level >= 2:
                    buses["drums"].add(ts, hat(False, 1.0 if sub in (0, 2) else 0.55), lift, pan=0.3)
            if level >= 3 and beat == 3:
                buses["drums"].add(tb + BEAT / 2, hat(True, 0.7), 1.0, pan=0.3)
            # bass: eighths on the root, octave jumps on the off-eighths from the fifth phase
            for sub in range(2):
                ts = tb + sub * BEAT / 2
                f = hz(CHORDS[chord_at(ts, by_id)][0], 0)
                buses["bass"].add(ts, bass_note(f, 0.2, octave_up=(level >= 3 and sub == 1)), lift * (1.0 if sub == 0 else 0.75))
            # arp: sixteenths over the chord tones, from half-way through the company
            if tb >= t_company + (by_id["company"]["dur"] / 2):
                tones = CHORDS[chord_at(tb, by_id)]
                notes = [hz(tones[0], 2), hz(tones[1], 2), hz(tones[2], 2), hz(tones[0], 3)]
                pattern = [0, 1, 2, 3, 2, 1]
                for sub in range(4):
                    ts = tb + sub * BEAT / 4
                    step = int(round((ts - t_company) / (BEAT / 4)))
                    cutoff = 1400 + 500 * level
                    note = arp_note(notes[pattern[step % 6]], cutoff)
                    gain = 0.8 * lift
                    buses["arp"].add(ts, note, gain, pan=-0.35)
                    for echo, delay in enumerate((3 * BEAT / 4, 6 * BEAT / 4, 9 * BEAT / 4)):
                        buses["arp"].add(ts + delay, note, gain * 0.38 ** (echo + 1), pan=0.5 if echo % 2 == 0 else -0.5)
        # lead stabs on the chord changes from the fifth phase, every bar in the ninth
        if t >= t_lead and (bar_index % 2 == 0 or t >= t_peak):
            chord = chord_at(t, by_id)
            st = stab(chord, 2600 + 400 * (level - 3))
            buses["lead"].add(t, st, 1.0, pan=0.15)
            buses["rev"].add(t, st, 0.5)
        # pad: one chord per two-bar step (one bar in the climb)
        step = BAR if t >= t_peak else 2 * BAR
        if bar_index % (1 if t >= t_peak else 2) == 0:
            chord = chord_at(t, by_id)
            length = min(step, t_close - t)
            pc = pad_chord(chord, length, 900 + 250 * level)
            buses["pad"].add(t, pc, 1.0)
            buses["rev"].add(t, pc.mean(axis=1), 0.4)
        t += BAR
        bar_index += 1

    # cuts: a riser into each, an impact on each; crashes on the peak and the close
    for s in plan[1:]:
        big = s["id"] in BIG_CUTS
        length = 2.0 if s["id"] == "company" else 1.5
        buses["fx"].add(s["start"] - length, riser(length, big), 1.0)
        imp = impact(big)
        buses["fx"].add(s["start"], imp, 1.0)
        buses["rev"].add(s["start"], imp, 0.35 if big else 0.2)
        if s["id"] in ("p9", "close"):
            buses["fx"].add(s["start"], crash(0.8 if s["id"] == "close" else 0.6), 1.0, pan=0.2)
        # snare rolls into the cuts from the third phase: sixteenths over the last beat, thirty-seconds in the last half of the big ones
        if INTENSITY[s["id"]] >= 2 and s["id"] != "p1":
            for k in range(4):
                buses["drums"].add(s["start"] - BEAT + k * BEAT / 4, snare(0.45 + 0.14 * k), 1.0)
            if big:
                for k in range(4):
                    buses["drums"].add(s["start"] - BEAT / 2 + k * BEAT / 8, snare(0.7 + 0.08 * k), 1.0)

    # the close: a held D major that rings out, a slowing arpeggio, a low D
    length = total - t_close
    pc = pad_chord("D", length, 1500, decay=3.2)
    buses["pad"].add(t_close, pc, 1.3)
    buses["rev"].add(t_close, pc.mean(axis=1), 0.6)
    n = n_of(length)
    buses["drone"].add(t_close, sine(hz(0, -1), n) * env_exp(n, 3.5), 0.9)
    tones = [hz(s, 2) for s in CHORDS["D"]] + [hz(0, 3)]
    for k in range(10):
        ts = t_close + 0.5 + k * BEAT / 2 * (1 + k * 0.08)
        buses["arp"].add(ts, arp_note(tones[[0, 1, 2, 3, 2, 1][k % 6]], 1800), 0.6 * 0.85 ** k, pan=-0.3 if k % 2 else 0.3)
    return buses, kick_env


def mix_music(buses: dict, kick_env: np.ndarray) -> np.ndarray:
    """Sum the buses with their gains, duck the tonal buses under the kick, add the reverb return."""
    duck = (1 - DUCK_KICK * kick_env)[:, None]
    out = (buses["drums"].buf * GAIN["drums"] + buses["fx"].buf * GAIN["fx"] + buses["drone"].buf * GAIN["drone"]
           + (buses["bass"].buf * GAIN["bass"] + buses["pad"].buf * GAIN["pad"] + buses["arp"].buf * GAIN["arp"] + buses["lead"].buf * GAIN["lead"]) * duck)
    send = buses["rev"].buf.mean(axis=1)
    wet = np.stack([reverb(send, 1.0), reverb(send, 1.07)], axis=1)
    return out + wet * GAIN["reverb"]


# ---------- the voice ----------
def speaker(voice: str, lang_code: str):
    """Kokoro-82M through the Homebrew espeak-ng; returns speak(text, speed) -> mono float32 at SR."""
    from misaki.espeak import EspeakWrapper
    EspeakWrapper.set_library(ESPEAK_LIB)
    EspeakWrapper.set_data_path(ESPEAK_DATA)
    from kokoro import KPipeline
    pipe = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M")

    def speak(text: str, speed: float) -> np.ndarray:
        """Speak one line; resampled to SR, trimmed, high-passed and peak-normalised."""
        parts = []
        for result in pipe(text, voice=voice, speed=speed):
            audio = result.audio if hasattr(result, "audio") else result[2]
            parts.append(np.asarray(audio, dtype=np.float32))
        x = np.concatenate(parts) if parts else np.zeros(1, dtype=np.float32)
        x = signal.resample_poly(x, 147, 80)                        # 24 kHz -> 44.1 kHz
        keep = np.where(np.abs(x) > 10 ** (-45 / 20))[0]
        if len(keep):
            x = x[max(0, keep[0] - n_of(0.05)): keep[-1] + n_of(0.12)]
        x = highpass(x, 80)
        return x / (np.max(np.abs(x)) + 1e-9) * 0.85
    return speak


def render_voice(plan: list, total: float, voice: str, lang_code: str) -> tuple:
    """Speak every scene's line (its `speak` form when present) into a mono track; returns (track, clip facts)."""
    speak = speaker(voice, lang_code)
    track = np.zeros(n_of(total))
    facts = []
    for s in plan:
        if not s.get("text"):
            continue
        avail = s["dur"] - VOICE_OFFSET - VOICE_END_MARGIN
        spoken = s.get("speak") or s["text"]
        speed = 1.0
        clip = speak(spoken, speed)
        if len(clip) / SR > avail:
            speed = min(MAX_SPEED, round(len(clip) / SR / avail * 1.03, 2))
            clip = speak(spoken, speed)
        start = s["start"] + VOICE_OFFSET
        fits = len(clip) / SR <= avail
        a = n_of(start)
        track[a:a + len(clip)] += clip[: len(track) - a]
        facts.append({"id": s["id"], "start": round(start, 2), "seconds": round(len(clip) / SR, 2), "speed": speed, "fits": fits,
                      "text": s["text"], **({"speak": s["speak"]} if s.get("speak") else {})})
        print(f"  {s['id']:8s} {len(clip) / SR:5.2f} s of {avail:4.1f} s  speed {speed}  {'ok' if fits else 'TOO LONG'}")
    return track, facts


def speech_gate(voice: np.ndarray) -> np.ndarray:
    """1 while a line is being spoken, 0 otherwise: a held, thresholded envelope with soft edges (about 0.15 s)."""
    held = maximum_filter1d(np.abs(voice), n_of(0.35))              # hold through the gaps between words
    gate = (held > 10 ** (-40 / 20)).astype(float)
    return np.clip(lowpass(gate, 4, order=1), 0, 1)


def duck_under_voice(music: np.ndarray, voice: np.ndarray) -> np.ndarray:
    """Lower the music by DUCK_VOICE while a line is spoken, with the gate's soft attack and release."""
    return music * (1 - DUCK_VOICE * speech_gate(voice))[:, None]


def dbfs(x: np.ndarray) -> float:
    """RMS level in dBFS."""
    return float(20 * np.log10(np.sqrt(np.mean(np.square(x))) + 1e-12))
