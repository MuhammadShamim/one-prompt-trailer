#!/usr/bin/env python3
"""Make the poster (assets/poster.png) from real frames of the film.

What it does:
  - opens docs/index.html in a headless Chromium-family browser at six moments, using the film's still mode
    (index.html#t=<seconds>&still), and saves each frame as a PNG in a temporary folder;
  - lays the frames out beside the headline on a small HTML page and saves that page as assets/poster.png.
Nothing is drawn by hand or taken from elsewhere: every picture on the poster is a frame of the film.
Needs: a built docs/index.html, and Brave, Chrome or Chromium (set BROWSER to its program if it is not found).
Run:   python3 make_poster.py

Author:  Muhammad Akhtar Shamim
Licence: MIT (see LICENSE)
Created: 2026-11-21
"""
import html
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FILM = os.path.join(HERE, "docs", "index.html")
POSTER = os.path.join(HERE, "assets", "poster.png")
BROWSERS = ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/usr/bin/chromium", "/usr/bin/google-chrome"]
FRAME_SIZE = (1280, 720)            # the size each frame is captured at
POSTER_SIZE = (1600, 900)           # the finished poster, in pixels
SETTLE_MS = 9000                    # time the page is given to build its scenes before the frame is taken
# the moments shown, in seconds: the office, the meeting, the crew, the film arriving, the city, the premiere
MOMENTS = [3.4, 16.5, 32.5, 52.0, 70.5, 118.0]
HEADLINE = "Your project. As a movie trailer."
TAGLINE = "One prompt to start. A cinematic film out."
POINTS = ["Live 3D scenes", "AI voice", "Music made in code", "One HTML file, or an MP4"]
BADGE = "Made with AI · MIT code · CC BY 4.0 film"

PAGE = """<!doctype html><meta charset="utf-8"><title>Poster</title>
<style>
  html, body {{ margin: 0; width: {w}px; height: {h}px; background: #0b1017; color: #e6ebf1; overflow: hidden;
               font-family: "Source Sans 3", "Segoe UI", system-ui, sans-serif; }}
  .wrap {{ display: grid; grid-template-columns: 560px 1fr; gap: 44px; height: 100%; padding: 56px; box-sizing: border-box; }}
  .words {{ display: flex; flex-direction: column; justify-content: center; gap: 22px; }}
  .kicker {{ font: 700 20px/1 ui-monospace, "JetBrains Mono", Menlo, monospace; letter-spacing: 0.18em; color: #5fc5cf; }}
  h1 {{ margin: 0; font: 700 74px/1.04 Fraunces, Georgia, serif; letter-spacing: -0.01em; }}
  .tag {{ font-size: 30px; color: #f2c14e; font-weight: 600; }}
  ul {{ margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; font-size: 26px; }}
  li::before {{ content: "\\25B6"; color: #5fc5cf; font-size: 16px; margin-right: 14px; vertical-align: 3px; }}
  .badge {{ margin-top: 14px; align-self: flex-start; padding: 10px 18px; border: 1px solid rgba(230, 235, 241, 0.3);
            border-radius: 999px; font-size: 19px; color: #aeb7c1; }}
  .frames {{ display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr); gap: 14px; align-content: center; }}
  .frames img {{ width: 100%; height: 100%; object-fit: cover; border-radius: 12px; box-shadow: 0 10px 34px rgba(0, 0, 0, 0.55); }}
</style>
<div class="wrap">
  <div class="words">
    <div class="kicker">ONE-PROMPT TRAILER</div>
    <h1>{headline}</h1>
    <div class="tag">{tagline}</div>
    <ul>{points}</ul>
    <div class="badge">{badge}</div>
  </div>
  <div class="frames">{frames}</div>
</div>
"""


def find_browser() -> str:
    """Return the browser program: $BROWSER when set, otherwise the first known one that exists."""
    wanted = os.environ.get("BROWSER")
    for program in ([wanted] if wanted else []) + BROWSERS:
        if program and os.path.exists(program):
            return program
    raise SystemExit("No Chromium-family browser found. Set BROWSER to the path of Brave, Chrome or Chromium.")


def capture(browser: str, address: str, size: tuple, out: str) -> None:
    """Save a picture of `address` at `size` (width, height) to the file `out`."""
    subprocess.run([browser, "--headless=new", "--disable-gpu-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
                    "--hide-scrollbars", f"--window-size={size[0]},{size[1]}", f"--virtual-time-budget={SETTLE_MS}",
                    f"--screenshot={out}", address], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not os.path.exists(out):
        raise SystemExit(f"The browser wrote no picture for {address}")


def main() -> int:
    """Capture the frames, lay out the poster page, and save it as a picture."""
    if not os.path.exists(FILM):
        raise SystemExit("docs/index.html is missing: run build.py first.")
    browser = find_browser()
    os.makedirs(os.path.dirname(POSTER), exist_ok=True)
    with tempfile.TemporaryDirectory() as work:
        frames = []
        for moment in MOMENTS:
            frame = os.path.join(work, f"frame-{moment}.png")
            capture(browser, f"file://{FILM}#t={moment}&still", FRAME_SIZE, frame)
            frames.append(f'<img alt="" src="file://{frame}">')
        page = os.path.join(work, "poster.html")
        with open(page, "w", encoding="utf-8") as f:
            f.write(PAGE.format(w=POSTER_SIZE[0], h=POSTER_SIZE[1], headline=html.escape(HEADLINE), tagline=html.escape(TAGLINE),
                                points="".join(f"<li>{html.escape(p)}</li>" for p in POINTS), badge=html.escape(BADGE), frames="".join(frames)))
        capture(browser, f"file://{page}", POSTER_SIZE, POSTER)
    print(json.dumps({"poster": os.path.relpath(POSTER, HERE), "frames": len(MOMENTS), "kilobytes": round(os.path.getsize(POSTER) / 1024)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
