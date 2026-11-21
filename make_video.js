#!/usr/bin/env node
/* make_video.js: record the film (docs/index.html) as a video file, and cut a short silent preview for the README.

   What it does:
     - starts a headless Chromium-family browser on the film in still mode (index.html#t=0&still) and talks to it over
       the DevTools protocol (no packages needed: Node 22 or later has fetch and WebSocket built in);
     - for every frame of the film it sets the film's clock to that exact moment (window.__film.seek), waits for the
       picture to be drawn, and saves a screenshot. The film is a pure function of its clock, so the result is the same
       film the page plays, however slow this computer is;
     - joins the frames with audio/track.mp3 into assets/trailer.mp4 (H.264 video, AAC sound) using FFmpeg;
     - cuts PREVIEW_CLIPS out of that video into assets/preview.gif, a small silent loop that plays inside the README.
   Needs: a built docs/index.html and audio/track.mp3; Brave, Chrome or Chromium (set BROWSER if it is not found); FFmpeg
          (set FFMPEG to its program, for example the one imageio-ffmpeg installs: see the README).
   Run:   FFMPEG=/path/to/ffmpeg node make_video.js              the whole film and the preview
          node make_video.js --from 10 --to 12                   only that stretch, to try it out (no preview)
          node make_video.js --workers 4                         four browsers at once, each recording its own stretch
          node make_video.js --width 1080 --height 1920          a tall video for phones, written beside the wide one as
                                                                 assets/trailer-1080x1920.mp4 (no preview)

   Author:  Muhammad Akhtar Shamim
   Licence: MIT (see LICENSE)
   Created: 2026-11-21 */
"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HERE = __dirname;
const FILM = path.join(HERE, "docs", "index.html");
const TRACK = path.join(HERE, "audio", "track.mp3");
const VIDEO = path.join(HERE, "assets", "trailer.mp4");
const PREVIEW = path.join(HERE, "assets", "preview.gif");
const BROWSERS = ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
                  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"];
const WIDTH = 1280, HEIGHT = 720;     // the video's size in pixels, unless --width and --height say otherwise
const FPS = 24;                       // frames per second of film
const JPEG_QUALITY = 92;              // quality of each captured frame
const VIDEO_QUALITY = 19;             // H.264 CRF: lower is better and larger
const DEBUG_PORT = 9333;              // where the first browser listens for this script; each further worker takes the next port
const WORKERS = 1;                    // browsers recording at once, unless --workers says otherwise
// how the browser draws 3D: with the graphics card (fast), or in software when SOFTWARE_3D is set (slow, works anywhere)
const DRAW_WITH = process.env.SOFTWARE_3D ? ["--disable-gpu-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
  : ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=" + (process.platform === "darwin" ? "metal" : "default")];
const START_TIMEOUT_MS = 30000;       // how long to wait for the browser, and for the film to build its scenes
const PREVIEW_CLIPS = [[1.5, 4.5], [22, 25], [49, 53], [87, 90]];   // [from, to] seconds of film shown in the preview
const PREVIEW_WIDTH = 560, PREVIEW_FPS = 10;
// written into the video file itself, so the disclosure travels with it
const VIDEO_NOTE = "Made with AI: pictures drawn by code (Three.js), a synthetic voice (Kokoro-82M), music synthesised in code. Recorded by make_video.js.";

/** Read "--name value" from the command line, or return `fallback`. */
function option(name, fallback) {
  const at = process.argv.indexOf("--" + name);
  return at > 0 && process.argv[at + 1] !== undefined ? Number(process.argv[at + 1]) : fallback;
}

/** The first program in `candidates` that exists, or stop with `message`. */
function findProgram(candidates, message) {
  const found = candidates.filter(Boolean).find(function (p) { return fs.existsSync(p); });
  if (!found) { console.error(message); process.exit(1); }
  return found;
}

/** Resolve after `ms` milliseconds. */
function sleep(ms) { return new Promise(function (done) { setTimeout(done, ms); }); }

/** Connect to the page of the browser listening on `port` and return send(method, params), which resolves with the reply. */
async function connect(port) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let target = null;
  while (!target && Date.now() < deadline) {
    try {
      const pages = await (await fetch("http://127.0.0.1:" + port + "/json")).json();
      target = pages.find(function (p) { return p.type === "page" && p.url.indexOf("index.html") >= 0; });
    } catch (notYet) { /* the browser is still starting */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("The browser did not open the film in time.");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(function (open, fail) { socket.onopen = open; socket.onerror = fail; });
  const waiting = new Map();
  let nextId = 1;
  socket.onmessage = function (event) {
    const reply = JSON.parse(event.data);
    if (reply.id && waiting.has(reply.id)) { waiting.get(reply.id)(reply); waiting.delete(reply.id); }
  };
  return function send(method, params) {
    return new Promise(function (done, fail) {
      const id = nextId++;
      waiting.set(id, function (reply) { if (reply.error) fail(new Error(method + ": " + reply.error.message)); else done(reply.result); });
      socket.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  };
}

/** Run `expression` in the page and return its value (a promise is awaited). */
async function inPage(send, expression) {
  const reply = await send("Runtime.evaluate", { expression: expression, awaitPromise: true, returnByValue: true });
  if (reply.exceptionDetails) throw new Error("In the page: " + reply.exceptionDetails.text);
  return reply.result.value;
}

/** Capture frames `first` to `last` (counted at FPS) into `folder`, numbering each file from `origin`, the first frame of the
    whole recording, so that several workers can fill one folder. Returns how many were written. */
async function captureFrames(send, first, last, folder, origin) {
  const began = Date.now();
  for (let n = first; n <= last; n++) {
    // set the clock, then let two animation frames pass so the scene is updated and drawn
    await inPage(send, "window.__film.seek(" + (n / FPS) + "); new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { r(1); }); }); })");
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: JPEG_QUALITY });
    fs.writeFileSync(path.join(folder, "f" + String(n - origin + 1).padStart(6, "0") + ".jpg"), Buffer.from(shot.data, "base64"));
    if ((n - first) % (FPS * 5) === 0) console.log("  " + (n / FPS).toFixed(0) + " s of film captured, " + ((Date.now() - began) / 1000).toFixed(0) + " s elapsed");
  }
  return last - first + 1;
}

/** Record the film (or the stretch asked for) and, for a whole film, cut the preview. */
async function main() {
  const browser = findProgram([process.env.BROWSER].concat(BROWSERS), "No Chromium-family browser found. Set BROWSER to the path of Brave, Chrome or Chromium.");
  const ffmpeg = findProgram([process.env.FFMPEG, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"], "FFmpeg not found. Set FFMPEG to its program.");
  if (!fs.existsSync(FILM) || !fs.existsSync(TRACK)) { console.error("docs/index.html or audio/track.mp3 is missing: build the film first."); process.exit(1); }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "trailer-video-"));
  const frames = path.join(work, "frames");
  fs.mkdirSync(frames);
  fs.mkdirSync(path.dirname(VIDEO), { recursive: true });
  const workers = Math.max(1, option("workers", WORKERS));
  const width = option("width", WIDTH), height = option("height", HEIGHT);
  const about = JSON.parse(fs.readFileSync(path.join(HERE, "scenes.json"), "utf8"));
  const browsers = [];
  /** Start one browser on the film, wait until its scenes are built, and return a way to talk to it. */
  async function openFilm(port) {
    browsers.push(spawn(browser, ["--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + path.join(work, "profile-" + port),
      ].concat(DRAW_WITH).concat(["--hide-scrollbars", "--mute-audio",
      "--window-size=" + width + "," + height, "file://" + FILM + "#t=0&still"]), { stdio: "ignore" }));
    const send = await connect(port);
    await send("Emulation.setDeviceMetricsOverride", { width: width, height: height, deviceScaleFactor: 1, mobile: false });
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (!(await inPage(send, "!!(window.__film && document.body.classList.contains('ready'))"))) {
      if (Date.now() > deadline) throw new Error("The film did not finish building its scenes in time.");
      await sleep(250);
    }
    return send;
  }
  try {
    const sends = await Promise.all(Array.from({ length: workers }, function (unused, w) { return openFilm(DEBUG_PORT + w); }));
    const total = await inPage(sends[0], "window.__film.total");
    const from = option("from", 0), to = Math.min(option("to", total), total), whole = from === 0 && to === total;
    const first = Math.round(from * FPS), last = Math.round(to * FPS) - 1, count = last - first + 1, share = Math.ceil(count / workers);
    console.log("recording " + from + " s to " + to + " s of " + total + " s at " + FPS + " frames a second, " + width + "x" + height + ", " + workers + " at once");
    // each worker takes the next `share` frames; the files are numbered across the whole recording
    await Promise.all(sends.map(function (send, w) {
      const begin = first + w * share, end = Math.min(last, begin + share - 1);
      return begin > last ? 0 : captureFrames(send, begin, end, frames, first);
    }));
    // only the standard-size whole film replaces assets/trailer.mp4; another size gets its own file and leaves the preview alone
    const standard = width === WIDTH && height === HEIGHT;
    const name = !whole ? "trailer-part.mp4" : standard ? path.basename(VIDEO) : "trailer-" + width + "x" + height + ".mp4";
    const out = path.join(path.dirname(VIDEO), name);
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(frames, "f%06d.jpg"), "-ss", String(from), "-i", TRACK,
      "-t", String(count / FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", String(VIDEO_QUALITY), "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart",
      "-metadata", "title=" + about.brand, "-metadata", "artist=" + about.author, "-metadata", "copyright=" + about.notice,
      "-metadata", "comment=" + VIDEO_NOTE, "-metadata", "creation_time=" + new Date().toISOString(), out], { stdio: "inherit" });
    console.log("wrote " + path.relative(HERE, out) + "  " + (fs.statSync(out).size / 1048576).toFixed(1) + " MB  " + count + " frames");
    if (whole && standard) {
      const keep = PREVIEW_CLIPS.map(function (c) { return "between(t," + c[0] + "," + c[1] + ")"; }).join("+");
      execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", VIDEO, "-an", "-filter_complex",
        "select='" + keep + "',setpts=N/FRAME_RATE/TB,fps=" + PREVIEW_FPS + ",scale=" + PREVIEW_WIDTH + ":-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
        PREVIEW], { stdio: "inherit" });
      console.log("wrote " + path.relative(HERE, PREVIEW) + "  " + (fs.statSync(PREVIEW).size / 1048576).toFixed(1) + " MB");
    }
  } finally {
    browsers.forEach(function (b) { b.kill(); });
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch(function (problem) { console.error(problem.message); process.exit(1); });
