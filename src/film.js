/* film.js: the film. Twelve Three.js scenes, their titles, a scrubber with chapters, and the embedded track as the clock.

   How it is put together:
     - helpers (easing, seeded random, text and glow sprites, painted canvas textures);
     - props and people (person(), pose(), deskSet(), officeRoom(), workshop(), laptopProp(), tag() ...);
     - one builder per scene in `builders`, each returning { group, update(u, t), cam or shots, ... } where `u` is the scene's
       story progress from 0 to 1 and `t` is the film clock in seconds;
     - the director (enter(), placeCamera(), progress(), frame()) and the player controls.
   Every animation is a pure function of (u, t), so seeking anywhere redraws the right frame.
   Reads the JSON data block #trailer-data (scenes, facts) written by build.py. Inlined into the page by build.py.
   Open the built page with #t=42 to start paused at 42 seconds, and #t=42&still to hide the player (used for the poster).

   Author:  Muhammad Akhtar Shamim
   Licence: MIT (see LICENSE)
   Created: 2026-11-21 */
(function () {
  "use strict";
  document.body.classList.add("js");          // the film is shown only when the script runs; without it the fallback note shows

  /* ---------- constants ---------- */
  var FADE_SECONDS = 0.45;            // fade to black on every cut
  var TITLE_IN = 0.05;                // scene progress at which the lower third enters
  var TITLE_OUT = 0.86;               // ... and leaves
  var IDLE_MS = 2800;                 // controls hide after this much stillness while playing
  var MAX_DELTA = 0.1;                // a tab that was hidden does not jump the clock
  var FONT_WAIT_MS = 1500;            // wait this long for the web fonts before building labels
  var BG = 0x0b1017;                  // the stage colour (Asphalt, darker)
  var FLOOR = 0x111a24;
  var GRID = 0x1d2a38;
  var TEAL = 0x0e7c86;                // Lane Teal, the brand accent
  var AMBER = 0xb4620f;               // Signal Amber
  var BLUE = 0x2a6db5;
  var OK = 0x2f7d4f;
  var WHITE = 0xffffff;
  var LOOK_DROP = 0.8;                // the camera aims this far below each scene's subject, lifting it clear of the titles
  var PORTRAIT_PULL = 1.9;            // on a portrait screen the camera stands this much further back, so wide scenes fit
  var NIGHT_FILL = 0x3a4a5c, AMBIENT_LIGHT = 0.5, HEMI_LIGHT = 0.7;   // the stage's soft fill light, as it is at night
  var NIGHT_HAZE = 0.03, DAY_HAZE = 0.008;                             // fog density indoors and at night, and in daylight
  var DAY_BG = 0x9fc9ee;              // the sky of a daylight scene
  var SCREEN_GLOW = 2.4;              // the laptop screen's light on its user: enough to tint the face, not to bleach it
  var LAMP_LIGHT = 2.6;               // the desk lamp's light on the desk and the person at it
  var ACCENT_LIGHT = 60;              // the coloured stage light of the open scenes; a scene in a room sets `accent: 0`
  var SHADOW_MAP = 2048;              // the key light's shadow map, in pixels
  var SHADOW_REACH = 16;              // half the width of the area that receives shadows
  var SOFT_SHADOWS = 2;               // three.js PCFSoftShadowMap (the constant is not in the bundle)
  var SYNC_TOLERANCE = 0.3;           // when play starts, the track is moved to the trailer clock if it is further off than this

  var THREE = window.THREE;
  var data = JSON.parse(document.getElementById("trailer-data").textContent);
  var scenes = data.scenes;
  var LANG = data.lang || "en", TX = data.text || {};
  /** A string from the data block's text map, or the English default. */
  function tx(key, dflt) { return typeof TX[key] === "string" ? TX[key] : dflt; }
  var LABEL_FONT = LANG === "ur" ? "600 64px 'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', serif" : "600 64px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif";
  var LABEL_TALL = LANG === "ur" ? 2.1 : 1;      // Nastaliq hangs far below the baseline, so its label canvas is taller
  var TOTAL = scenes.reduce(function (s, sc) { return s + sc.dur; }, 0);
  (function cumulate() {
    var at = 0;
    scenes.forEach(function (sc) { sc.start = at; at += sc.dur; sc.end = at; });
  })();

  /* ---------- small helpers ---------- */
  /** Deterministic pseudo-random generator (mulberry32) so every build of a scene is identical. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function lerp(a, b, u) { return a + (b - a) * u; }
  /** Progress of u inside the window [a, b], clamped to 0..1. */
  function span(u, a, b) { return clamp01((u - a) / (b - a)); }
  function smooth(u) { u = clamp01(u); return u * u * (3 - 2 * u); }
  function outCubic(u) { u = clamp01(u); return 1 - Math.pow(1 - u, 3); }
  function inOutCubic(u) { u = clamp01(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
  function frac(x) { return x - Math.floor(x); }
  function v3(a) { return new THREE.Vector3(a[0], a[1], a[2]); }
  function hex(s) { return parseInt(s.replace("#", ""), 16); }
  function fmtTime(s) {
    var m = Math.floor(s / 60), r = Math.floor(s - m * 60);
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  function fmtInt(n) { return Math.round(n).toLocaleString("en-US"); }

  /* ---------- textures and sprites ---------- */
  /** A soft radial glow as an additive sprite. */
  function glowSprite(colour, scale, opacity) {
    var c = document.createElement("canvas"), g = c.getContext("2d"), grd;
    c.width = c.height = 128;
    grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.35, "rgba(255,255,255,0.35)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(c);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: colour, transparent: true, opacity: opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.scale.set(scale, scale, 1);
    return sp;
  }
  /** A soft round dot texture, so point clouds draw as discs instead of squares (made once). */
  var dotTexture = null;
  function dot() {
    if (dotTexture) return dotTexture;
    var c = document.createElement("canvas"), g = c.getContext("2d"), grd;
    c.width = c.height = 64;
    grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.6, "rgba(255,255,255,0.9)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    dotTexture = new THREE.CanvasTexture(c);
    return dotTexture;
  }
  /** A text label as a sprite: world height `size`, drawn once on a 2x canvas. */
  function label(text, colour, size, font) {
    var pad = 24, px = 64, dpr = 2;
    var c = document.createElement("canvas"), g = c.getContext("2d");
    g.font = font || LABEL_FONT;
    var w = Math.ceil(g.measureText(text).width) + pad * 2, h = Math.round(px * LABEL_TALL) + pad * 2;
    c.width = w * dpr; c.height = h * dpr;
    g.scale(dpr, dpr);
    g.font = font || LABEL_FONT;
    g.direction = LANG === "ur" ? "rtl" : "ltr";
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = colour;
    g.fillText(text, pad, h / 2);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(size * w / h, size, 1);
    return sp;
  }

  /* ---------- geometry helpers ---------- */
  /** The brand chevron ("^" with a stroke) as an extruded mesh. */
  function chevron(colour, emissive) {
    var w = 0.8, h = 0.6, s = 0.3, k = h * (1 - s / w);
    var shape = new THREE.Shape();
    shape.moveTo(-w, 0); shape.lineTo(0, h); shape.lineTo(w, 0); shape.lineTo(w - s, 0); shape.lineTo(0, h - k); shape.lineTo(-w + s, 0); shape.closePath();
    var geo = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false });
    geo.translate(0, 0, -0.11);
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: emissive, metalness: 0.25, roughness: 0.45 }));
  }
  /** The stage floor: a dark plane and a faint grid, shared by most scenes. */
  function floorGroup() {
    var g = new THREE.Group();
    var plane = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.95, metalness: 0 }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.02;
    plane.receiveShadow = true;
    g.add(plane);
    var pts = [], n = 36, half = 36;
    for (var i = -n; i <= n; i++) {
      pts.push(i * 2, 0, -half, i * 2, 0, half);
      pts.push(-half, 0, i * 2, half, 0, i * 2);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: GRID, transparent: true, opacity: 0.6 })));
    return g;
  }
  /** Drifting dust: additive points in a box, moved by absolute time in update(). */
  function dust(count, seed, colour) {
    var r = rng(seed), pos = [];
    for (var i = 0; i < count; i++) pos.push((r() - 0.5) * 36, r() * 9, (r() - 0.5) * 36);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    var pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: colour, map: dot(), size: 0.09, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    pts.userData.base = pos.slice();
    return pts;
  }
  function moveDust(pts, t) {
    var a = pts.geometry.attributes.position, b = pts.userData.base;
    for (var i = 0; i < a.count; i++) {
      a.array[i * 3 + 1] = (b[i * 3 + 1] + t * 0.12) % 9;
      a.array[i * 3] = b[i * 3] + Math.sin(t * 0.3 + i) * 0.2;
    }
    a.needsUpdate = true;
  }

  /* ---------- renderer, camera, lights ---------- */
  var canvas = document.getElementById("stage");
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
  } catch (e) {
    renderer = null;
  }
  if (!renderer) {
    document.body.classList.add("no-webgl");
    return;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = SOFT_SHADOWS;
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.FogExp2(BG, NIGHT_HAZE);
  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  var ambient = new THREE.AmbientLight(NIGHT_FILL, AMBIENT_LIGHT);
  var hemi = new THREE.HemisphereLight(0x9fb3c8, BG, HEMI_LIGHT);
  var key = new THREE.DirectionalLight(WHITE, 2.2);
  key.position.set(6, 10, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  key.shadow.camera.left = key.shadow.camera.bottom = -SHADOW_REACH;
  key.shadow.camera.right = key.shadow.camera.top = SHADOW_REACH;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  var rim = new THREE.DirectionalLight(0x9fc4ff, 1.4);    // from behind, so every figure has a bright edge
  rim.position.set(-6, 6, -9);
  scene.add(rim);
  var accent = new THREE.PointLight(TEAL, ACCENT_LIGHT, 0, 2);
  accent.position.set(-5, 4, 3);
  scene.add(ambient, hemi, key, accent);
  var floor = floorGroup();
  scene.add(floor);
  var dummy = new THREE.Object3D();

  function resize() {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    var phone = w < 700;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = phone ? 56 : 42;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  /* ---------- scene builders: each returns { group, update(u, t), cam, floor } ---------- */
  var builders = {};
  var PAGE_GREY = 0x4f5d75;           // an unread page
  var FILE_TYPES = [[".py", "#2f6f9f"], [".pdf", "#c2452b"], [".pptx", "#d98a0a"], [".xlsx", "#1e7f5c"], [".docx", "#2a6db5"], [".csv", "#6a4bb5"]];   // the project files of the first step
  var ROAD_WIDTH = 4.4;               // the city street of the second step
  var TOWERS = 22, SKYLINE = 16;      // towers along the street, and taller ones behind them
  var PAVEMENT = 3.6;                 // from the kerb to the building line
  var BLUEPRINT = 0x0b3a6b;           // the ink of the towers' outlines, dark enough to read against the sky
  var BILLBOARD_Z = -36;              // the billboard at the end of the street
  var WALKERS = 8;
  var CITY_COATS = [0xc2452b, 0xf2c14e, 0x2fb6c4, 0xb39ded, 0x6fcf9f, 0xe8edf2];
  var BUILDER = 0x2fb6c4;             // the hero's colour, the same in every scene
  var SKIN_TONES = ["#f0c9a4", "#c98f62", "#8d5a3b", "#f6d7bd"];
  var HAIR_TONES = ["#3a2a20", "#1b1b1f", "#7a4a22", "#c9a25a"];
  var TROUSERS = 0x27344a;
  var FACE_W = 1024, FACE_H = 512;    // the face canvas, wrapped once around the head
  var EYE_GAP = 56;                   // pixels from the face's centre line to each eye
  var HIP = 0.92, THIGH = 0.44, SHIN = 0.42;          // body measures, in world units
  var SHOULDER = 1.55, UPPER_ARM = 0.34, FOREARM = 0.32;
  var NECK = 1.72, HEAD = 0.25;
  var HAIR_COVER = 0.44;              // how far down the head the hair reaches, as a share of a half turn
  var FINGER_X = [-0.036, -0.012, 0.012, 0.036];   // the four fingers across the palm
  var MUG_GRIP = [0.108, 0, 0.125];                 // from the gripping wrist to the centre of the mug: the palm stays behind the
                                                    // handle and only the fingers pass through its ring, clear of the cup
  var HANDLE_CURL = 0.12;             // fingers stay nearly straight through the handle (a fuller curl would enter the cup)
  var MUG_ON_DESK = 1.118;            // the height of a mug's centre when it stands on the desk
  var SIP_TILT = 0.6;                 // how far the mug tips at the mouth
  var FINGER_REST = 0.4, FINGER_CURL = 1.5;         // knuckle angles: relaxed, and the extra curl of a full grip
  var REACH = { x: -0.55, bend: -1.25, z: -0.8 };   // the character's right arm reaching out for the mug on the desk
  var SIP = { x: -1.5, bend: -1.75, z: 0.55 };       // ... and holding it at the mouth
  var MUG_IN_USE = 0xc2452b;          // the mug being drunk from is red, so it reads against the pale hoodie
  var ELBOW_REST = -0.2;              // a relaxed arm is slightly bent
  var TYPING_ELBOW = -1.25;           // forearms level over the keyboard
  var CROWD = [0x5b6b82, 0x6a5f86, 0x4f7186, 0x7a6a5a];   // muted, so the hero stands out
  var SILHOUETTE = 0x141c26;          // the premiere's audience, dark against the bright screen
  var SEAT_Z = 0.24;                  // the chair is pulled in, so the hands reach the keys
  var WALL_Z = -2.6;                  // the room's back wall
  var BENCH_Z = WALL_Z + 0.55, BENCH_TOP = 1.05;   // the workshop bench: its centre line and the height of its top
  var ROOM_FRONT = 5.6, ROOM_HALF = 5.2, ROOM_HEIGHT = 5.6;   // the office: its front wall, half its width, its height
  var DAY_SKY = 0x8fc7ff;             // the colour of daylight falling into the room
  var BOOK_TITLES = ["AI", "JAVA", "ML", "SQL", "PYTHON", "TECH SALES", "LEADERSHIP", "DATA", "CLOUD", "AGENTS", "DEEP LEARNING", "STATISTICS", "NLP", "DEVOPS", "PRODUCT", "STRATEGY", "ALGORITHMS", "NEGOTIATION", "SYSTEM DESIGN", "MLOPS", "ANALYTICS", "STORYTELLING"];   // on the office shelf
  var SPINE_COLOURS = ["#2a6db5", "#c2452b", "#1e7f5c", "#d98a0a", "#6a4bb5", "#e8edf2"];
  // scene two: three people, three kinds of work, side by side (one room's width apart)
  var STATIONS = [
    { x: 0, kind: "app", done: "PUBLISHED", count: "VIEWS", wall: 0x33404f, who: null },
    { x: 10.4, kind: "report", done: "SENT", count: "OPENS", wall: 0x3d3a4d, who: { top: 0x8a63d2, skin: "#8d5a3b", hair: "#1b1b1f" } },
    { x: -10.4, kind: "deck", done: "SHARED", count: "REPLIES", wall: 0x3f4439, who: { top: 0xe0902c, skin: "#f6d7bd", hair: "#7a4a22" } }
  ];
  // the closing credits: what the film was made with, and what each did; they hang from CREDITS_TOP (the author's line),
  // high enough that the two rows of tools clear the scene's title at the bottom left
  var CREDITS_TOP = 6.4;
  var CREDITS = [["One prompt", "the brief"], ["Claude Code", "the AI assistant"], ["Three.js", "the 3D engine"],
                 ["Kokoro", "the AI voice"], ["Python + NumPy", "the music"], ["FFmpeg", "the sound mix"]];
  // scene ten: the file's names, where a video can go, and the scene's cuts: to the laptop, the phone, the wall, the export
  // panel, and the wall again
  var FILM_FILE = "trailer.html", VIDEO_FILE = "trailer.mp4";
  var SHARE_TO = ["A social post", "A video site", "A slide deck", "An email"];
  var FILE_CUTS = [0.279, 0.464, 0.536, 0.643, 0.829];
  // scene nine: what the music panel offers; the four layers of the music with the scene (counted from 0) at which each
  // enters, as in the film's own track; and the scene's cuts: to the bench, to the wall, and the note about where it comes from
  var MUSIC_KEY = ["D minor"], MUSIC_TEMPO = ["128 BPM"];   // the backing track's real key and tempo (see score.py)
  var MUSIC_LAYERS = [{ name: "Chords", from: 0, colour: "#b39ded" }, { name: "Drums", from: 1, colour: "#ef8578" }, { name: "Bass", from: 2, colour: "#5fc5cf" }, { name: "Melody", from: 6, colour: "#f2c14e" }];
  var MUSIC_CUTS = [0.27, 0.5, 0.74];
  var LAYER_BARS = 7;
  // scene eight: what the voice panel offers, the three claims that pop up over the tool, and the scene's cuts: to the bench,
  // to the wall, and the moment one line is recorded again
  var VOICES = ["Warm", "Bright", "Deep", "Calm"];
  var LANGUAGES = ["English", "French", "Spanish", "Hindi"];   // all spoken by the voice tool
  var VOICE_OFFERS = ["Many voices", "Several languages", "Your pace"];
  var VOICE_CUTS = [0.27, 0.5, 0.72];
  var SPEECH_BARS = 36;
  var WAVE_UP = 2.5, CLAIMS_UP = 3.6;  // heights above the bench of the big waveform and of the row of claims: the tools' own
                                       // name tags sit at 1.45, so the three layers never cross
  var REDO_CLIP = 4;                   // the clip that is recorded again on the wall screen
  // scene six: the files in the builder's project folder (their types are FILE_TYPES, in the same order), and the scene
  // progress between which they fly from the laptop to the assistant
  var PROJECT_FILES = ["analysis", "report", "pitch", "numbers", "notes", "data"];
  var FILES_FLY = [0.33, 0.68];
  // scene five: one prompt, four tools on a bench, one film. TOOL_AT is the scene progress at which each tool wakes (the moment
  // the voice names it); CABLE is the route of the spark from the laptop to the screen: [x, y, z, progress on arrival]
  var PROMPT_TEXT = "Make a trailer for my project";
  var PROMPT_SENT = 0.215;
  var TOOLS = [{ name: "AI assistant", colour: "#5fc5cf" }, { name: "3D engine", colour: "#7fb4ee" }, { name: "AI voice", colour: "#b39ded" }, { name: "Music", colour: "#ef8578" }];
  var TOOL_X = [-3.3, -1.1, 1.1, 3.3];
  var TOOL_AT = [0.293, 0.407, 0.521, 0.636];
  var TOOL_TRACK = [0.279, 0.736];
  var CABLE = [[0.4, 1.06, 1.3, 0.215], [-1.6, 0.04, 1.0, 0.24], [-4.3, 0.04, -1.0, 0.262], [-4.1, 1.1, -2.35, 0.28], [-3.3, 1.1, -2.35, 0.293], [-1.1, 1.1, -2.35, 0.407],
               [1.1, 1.1, -2.35, 0.521], [3.3, 1.1, -2.35, 0.636], [4.9, 1.1, -2.35, 0.69], [4.9, 3.75, -2.5, 0.72], [3.1, 3.75, -2.5, 0.736]];
  // scene four: the crafts behind a real film, one at a time (the camera tracks along them in this order)
  var CREW = [
    { id: "writer", role: "Writer", top: 0xb39ded }, { id: "director", role: "Director", top: 0xc2452b }, { id: "camera", role: "Camera", top: 0x4f5d75 },
    { id: "sound", role: "Sound", top: 0x6fcf9f }, { id: "lighting", role: "Lighting", top: 0xf2c14e }, { id: "editor", role: "Editor", top: 0x7fb4ee },
    { id: "animator", role: "Animator", top: 0xef8578 }, { id: "producer", role: "Producer", top: 0xe8edf2 }
  ];
  var MY_PROJECT = [["Team", "1"], ["Deadline", "Friday"], ["Film crew", "none"], ["Video budget", "none"]];   // the builder's board
  var DESK_TURN = 2.25;                // how far a desk worker is turned from the camera: enough to see the screen and a cheek
  var CREW_START = -10.5, CREW_GAP = 3;   // where the first of them stands, and the gap to the next
  var CREW_TRACK = [0.171, 0.714];       // scene progress at which the tracking shot starts and ends
  // scene three: the meeting room (its back and front walls and half its width), the six seats [x, z] and who sits in them
  var MEET_BACK = -5, MEET_FRONT = 6.4, MEET_HALF = 5.4;
  var SEATS = [[1.42, -1.2], [1.42, 0.6], [1.42, 2.4], [-1.42, -1.2], [-1.42, 0.6], [-1.42, 2.4]];
  var MEETING_COATS = [0xc2452b, 0xf2c14e, 0x6fcf9f, 0xb39ded, 0xe8edf2, 0x4f5d75];
  var MEETING_HABITS = ["phone", "asleep", "yawn", "tablet", "phone", "typing"];   // the sleeper, the yawner and the typist have laptops
  var PHONE = [0.085, 0.175], TABLET = [0.2, 0.28];   // width and height of the hand-held devices
  var DEVICE_REACH = 0.74;             // how far in front of its owner a laptop or tablet stands on the table
  var PRESS_AT = [0.11, 0.36, 0.59];   // scene progress at which each of them sends the work out
  var SILENCE_AT = 0.76;               // ... and at which every counter still reads zero
  var WINDOW_X = -2.6, WINDOW_Y = 3.1, WINDOW_W = 2.6, WINDOW_H = 1.9;   // the office window on the back wall
  var DAY_CYCLES = 3;                 // days that pass in the window during the first scene
  var CLOCK_TURNS = 40;               // hours the wall clock races through
  var INSIDE_ONLY = 1;                // three.js BackSide (the constant is not in the bundle)
  var REPEAT_WRAPPING = 1000;         // three.js RepeatWrapping (the constant is not in the bundle)
  var SEAT_DROP = -0.26;              // how far a seated person sits below standing height
  var TYPING = -0.55;                 // shoulder angle that, with TYPING_ELBOW, puts the hands on the keyboard
  var ARMS_UP = 2.6;                  // arm angle of a cheer
  var CALENDAR_DAYS = 21;             // three weeks of day tiles behind the desk
  var CROWD_SIZE = 12;                // passers-by in the silence scene
  var CINEMA_SCREEN_Z = -4.6, FRONT_ROW_Z = 2.2;   // the premiere: where the screen hangs and where the first row stands
  // the frames the cinema plays: [scene id, progress in that scene], captured from the film itself at start-up
  var PREMIERE_STILLS = [["night", 0.62], ["ship", 0.2], ["ignored", 0.12], ["wall", 0.45], ["spark", 0.9], ["live3d", 0.64]];
  var AUDIENCE_ROWS = 3;
  var AUDIENCE_SEATS = 9;

  /** A standard material in one colour; `glow` is its emissive strength. */
  function std(colour, glow) {
    return new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: glow || 0, roughness: 0.55, metalness: 0.1 });
  }
  /** The play triangle, extruded: the film's motif. */
  function playMark(colour, size) {
    var s = new THREE.Shape();
    s.moveTo(-0.55 * size, -0.65 * size); s.lineTo(0.75 * size, 0); s.lineTo(-0.55 * size, 0.65 * size); s.closePath();
    var geo = new THREE.ExtrudeGeometry(s, { depth: 0.3 * size, bevelEnabled: false });
    geo.translate(0, 0, -0.15 * size);
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.7, metalness: 0.25, roughness: 0.4 }));
  }
  /** A flat page: a thin slab (its first child) with four darker lines of "text". */
  function page() {
    var g = new THREE.Group();
    var slab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 2.0), new THREE.MeshStandardMaterial({ color: PAGE_GREY, roughness: 0.9 }));
    g.add(slab);
    for (var i = 0; i < 4; i++) {
      var ln = new THREE.Mesh(new THREE.BoxGeometry(i === 3 ? 0.7 : 1.1, 0.02, 0.1), new THREE.MeshStandardMaterial({ color: 0x2a3542, roughness: 1 }));
      ln.position.set(i === 3 ? -0.2 : 0, 0.04, -0.6 + i * 0.4);
      g.add(ln);
    }
    return g;
  }
  /* --- drawn textures: every image in the film is painted here on a canvas, nothing is downloaded --- */
  var textureCache = {};
  /** A canvas texture made once per key by `paint(context, width, height)`. */
  function painted(key, w, h, paint) {
    if (textureCache[key]) return textureCache[key];
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    paint(c.getContext("2d"), w, h);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    textureCache[key] = tex;
    return tex;
  }
  /** The head's skin with a face in the given mood (calm, tired, happy, sad, shock), wrapped so the face looks along +z. */
  function faceTexture(skin, mood) {
    return painted("face-" + skin + "-" + mood, FACE_W, FACE_H, function (g, w, h) {
      var cx = w * 0.25, cy = h * 0.5, eyeY = cy - 26, mouthY = cy + 62;
      g.fillStyle = skin;
      g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(226, 110, 96, 0.28)";
      [-1, 1].forEach(function (s) { g.beginPath(); g.ellipse(cx + s * 92, cy + 34, 30, 20, 0, 0, Math.PI * 2); g.fill(); });
      [-1, 1].forEach(function (s) {
        var ex = cx + s * EYE_GAP, open = mood === "tired" ? 0.45 : mood === "shock" ? 1.25 : 1;
        g.fillStyle = "#ffffff";
        g.beginPath(); g.ellipse(ex, eyeY, 21, 25 * open, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#3a2a22";
        g.beginPath(); g.ellipse(ex + (mood === "sad" ? 0 : s * 1), eyeY + (mood === "sad" ? 6 : 2), 12, Math.min(13, 24 * open), 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#ffffff";
        g.beginPath(); g.arc(ex + 5, eyeY - 4, 4, 0, Math.PI * 2); g.fill();
        if (mood === "tired") {
          g.fillStyle = "rgba(90, 70, 110, 0.35)";
          g.beginPath(); g.ellipse(ex, eyeY + 24, 22, 8, 0, 0, Math.PI * 2); g.fill();
        }
        var tilt = mood === "sad" ? -s * 10 : mood === "shock" ? 0 : mood === "happy" ? s * 3 : mood === "tired" ? -s * 4 : 0;
        var lift = mood === "shock" ? 22 : mood === "happy" ? 8 : 0;
        g.strokeStyle = "#3a2a22"; g.lineWidth = 8; g.lineCap = "round";
        g.beginPath(); g.moveTo(ex - 22, eyeY - 44 - lift - tilt); g.lineTo(ex + 22, eyeY - 44 - lift + tilt); g.stroke();
      });
      g.strokeStyle = "#7a3b34"; g.fillStyle = "#7a3b34"; g.lineWidth = 8; g.lineCap = "round";
      g.beginPath();
      if (mood === "happy") { g.arc(cx, mouthY - 14, 40, 0.12 * Math.PI, 0.88 * Math.PI); g.closePath(); g.fill(); }
      else if (mood === "sad") { g.arc(cx, mouthY + 34, 34, 1.2 * Math.PI, 1.8 * Math.PI); g.stroke(); }
      else if (mood === "shock") { g.ellipse(cx, mouthY + 4, 16, 22, 0, 0, Math.PI * 2); g.fill(); }
      else { g.moveTo(cx - 22, mouthY); g.lineTo(cx + 22, mouthY + (mood === "tired" ? 3 : 0)); g.stroke(); }
    });
  }
  /** Brushed wood: the desk top and the chair. */
  function woodTexture() {
    return painted("wood", 512, 256, function (g, w, h) {
      var r = rng(71);
      g.fillStyle = "#6b4a32";
      g.fillRect(0, 0, w, h);
      for (var i = 0; i < 90; i++) {
        g.strokeStyle = "rgba(" + (r() < 0.5 ? "40, 24, 14" : "150, 108, 72") + ", " + (0.12 + r() * 0.2) + ")";
        g.lineWidth = 1 + r() * 3;
        var y = r() * h;
        g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + r() * 14 - 7, w * 0.7, y + r() * 14 - 7, w, y + r() * 10 - 5); g.stroke();
      }
    });
  }
  /** A code editor: what the builder is looking at. */
  function codeTexture() {
    return painted("code", 512, 320, function (g, w, h) {
      var r = rng(83), ink = ["#7fd4ff", "#ffd27a", "#b6f09c", "#f59fc0", "#d6dde6"];
      g.fillStyle = "#101a26";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#1b2a3b";
      g.fillRect(0, 0, w, 26);
      for (var row = 0; row < 15; row++) {
        var x = 20 + Math.floor(r() * 3) * 22, y = 44 + row * 18;
        for (var k = 0; k < 2 + Math.floor(r() * 4); k++) {
          var len = 24 + r() * 80;
          g.fillStyle = ink[Math.floor(r() * ink.length)];
          g.fillRect(x, y, len, 7);
          x += len + 10;
        }
      }
    });
  }
  /** A laptop's deck seen from above: aluminium, a trackpad near the user (the top of the canvas) and five rows of dark keys with
      faint backlit legends towards the hinge. */
  function keyboardTexture() {
    return painted("keyboard", 880, 580, function (g, w, h) {
      var r = rng(91), rows = 5, cols = 14, left = 40, top = 250, kw = (w - left * 2) / cols, kh = 56;
      g.fillStyle = "#aeb7c1";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#98a2ad";
      g.fillRect(w / 2 - 150, 30, 300, 180);
      g.strokeStyle = "#848e99"; g.lineWidth = 3;
      g.strokeRect(w / 2 - 150, 30, 300, 180);
      g.fillStyle = "#2a323c";
      g.fillRect(left - 10, top - 10, w - (left - 10) * 2, rows * kh + 20);
      for (var row = 0; row < rows; row++) {
        for (var col = 0; col < cols; col++) {
          var wide = row === 0 && col > 3 && col < 10;
          if (wide && col !== 4) continue;
          g.fillStyle = "#11161c";
          g.fillRect(left + col * kw + 4, top + row * kh + 4, (wide ? kw * 6 : kw) - 8, kh - 8);
          if (wide) continue;
          g.fillStyle = "rgba(220, 235, 255, " + (0.45 + r() * 0.35) + ")";
          g.fillRect(left + col * kw + kw / 2 - 7, top + row * kh + kh / 2 - 7, 14, 14);
        }
      }
    });
  }
  /** A clapperboard's diagonal stripes, or (plain) its slate with ruled lines. */
  function clapTexture(stripes) {
    return painted("clap-" + stripes, 512, stripes ? 64 : 360, function (g, w, h) {
      g.fillStyle = stripes ? "#f4f4f4" : "#20262e";
      g.fillRect(0, 0, w, h);
      if (stripes) {
        g.fillStyle = "#14181d";
        for (var x = -h; x < w; x += 96) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.lineTo(x + h + 48, 0); g.lineTo(x + 48, h); g.fill(); }
        return;
      }
      g.strokeStyle = "#e8edf2"; g.lineWidth = 4; g.fillStyle = "#e8edf2"; g.font = "600 34px 'Source Sans 3', system-ui, sans-serif";
      [["SCENE", 70], ["TAKE", 170], ["DATE", 270]].forEach(function (row) {
        g.fillText(row[0], 28, row[1]);
        g.beginPath(); g.moveTo(170, row[1] + 6); g.lineTo(w - 28, row[1] + 6); g.stroke();
      });
    });
  }

  /** A hand hanging from the wrist: a palm, four fingers hinged at the knuckles and a thumb on the inner side (`side` is -1
      left, 1 right). closeHand() curls it. A silhouette gets a plain mitt. */
  function handShape(skin, side, plain) {
    var g = new THREE.Group();
    g.userData.fingers = [];
    if (plain) {
      var mitt = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), skin);
      mitt.position.y = -0.03;
      g.add(mitt);
      return g;
    }
    var palm = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), skin);
    palm.position.y = -0.045;
    palm.scale.set(1, 1.15, 0.55);
    g.add(palm);
    FINGER_X.forEach(function (x, i) {
      var knuckle = new THREE.Group(), len = 0.075 - Math.abs(i - 1.5) * 0.008;
      knuckle.position.set(x, -0.095, 0.008);
      var finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.0145, len, 4, 8), skin);
      finger.position.y = -len / 2 - 0.005;
      knuckle.add(finger);
      g.add(knuckle);
      g.userData.fingers.push(knuckle);
    });
    var thumb = new THREE.Group();
    thumb.position.set(-side * 0.052, -0.04, 0.012);
    var thumbTip = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.045, 4, 8), skin);
    thumbTip.position.y = -0.03;
    thumb.add(thumbTip);
    thumb.userData.side = side;
    g.add(thumb);
    g.userData.thumb = thumb;
    closeHand(g, 0);
    return g;
  }
  /** Fingers tapping keys: each knuckle dips in turn, `amount` 0..1 strong. */
  function tapFingers(hand, t, amount) {
    hand.userData.fingers.forEach(function (knuckle, i) {
      knuckle.rotation.x = -FINGER_REST - 0.45 * amount * Math.max(0, Math.sin(t * 17 + i * 1.7 + hand.id));
    });
  }
  /** Curl a hand's fingers and thumb: 0 is relaxed, 1 is a fist around something. */
  function closeHand(hand, k) {
    hand.userData.fingers.forEach(function (knuckle) { knuckle.rotation.x = -FINGER_REST - FINGER_CURL * k; });
    var thumb = hand.userData.thumb;
    if (thumb) thumb.rotation.set(-0.9 * k, 0, -thumb.userData.side * (0.75 - 0.35 * k));
  }
  /** A limb segment of length `len` hanging from its parent's origin. */
  function limb(radius, len, mat) {
    var m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len - radius, 6, 14), mat);
    m.position.y = -len / 2;
    return m;
  }
  /** A person with a face, hair, clothes and jointed limbs; feet at the origin, facing +z.
      look: { silhouette (one dark shape), skin and hair (CSS colours), trousers (hex) }. Returns the group and the parts pose() moves. */
  function person(colour, look) {
    look = look || {};
    var flat = !!look.silhouette, skinHex = look.skin || SKIN_TONES[0];
    var top = new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: flat ? 0 : 0.18, roughness: 0.85 });
    var trousers = flat ? top : new THREE.MeshStandardMaterial({ color: look.trousers || TROUSERS, roughness: 0.8 });
    var skin = flat ? top : new THREE.MeshStandardMaterial({ color: hex(skinHex), emissive: hex(skinHex), emissiveIntensity: 0.12, roughness: 0.6 });
    var shoeMat = flat ? top : new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.5 });
    var g = new THREE.Group(), p = { group: g, skinHex: skinHex, face: null };

    function leg(x) {
      var hip = new THREE.Group(), knee = new THREE.Group();
      hip.position.set(x, HIP, 0);
      knee.position.y = -THIGH;
      var shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.2, 4, 12), shoeMat);
      shoe.rotation.x = Math.PI / 2;
      shoe.position.set(0, -SHIN, 0.09);
      knee.add(limb(0.095, SHIN, trousers), shoe);
      hip.add(limb(0.115, THIGH, trousers), knee);
      g.add(hip);
      return { hip: hip, knee: knee };
    }
    function arm(x) {
      var shoulder = new THREE.Group(), elbow = new THREE.Group();
      shoulder.position.set(x, SHOULDER, 0);
      elbow.position.y = -UPPER_ARM;
      var hand = handShape(skin, x < 0 ? -1 : 1, flat);
      hand.position.y = -FOREARM - 0.01;
      var cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.06, 14), top);
      cuff.position.y = -FOREARM + 0.03;
      elbow.add(limb(0.075, FOREARM, top), cuff, hand);
      shoulder.add(limb(0.088, UPPER_ARM, top), elbow);
      g.add(shoulder);
      return { shoulder: shoulder, elbow: elbow, hand: hand };
    }
    var legL = leg(-0.14), legR = leg(0.14), armL = arm(-0.37), armR = arm(0.37);
    p.legL = legL.hip; p.kneeL = legL.knee; p.legR = legR.hip; p.kneeR = legR.knee;
    p.armL = armL.shoulder; p.elbowL = armL.elbow; p.armR = armR.shoulder; p.elbowR = armR.elbow;
    p.handL = armL.hand; p.handR = armR.hand;

    var torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.36, 8, 20), top);
    torso.position.y = HIP + 0.37;
    torso.scale.set(1.18, 1, 0.82);
    var hips = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), trousers);
    hips.position.y = HIP + 0.02;
    hips.scale.set(1.08, 0.6, 0.8);
    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.16, 14), skin);
    neck.position.y = NECK - 0.02;
    var hood = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.065, 10, 24), top);
    hood.rotation.x = Math.PI / 2 - 0.25;
    hood.position.set(0, NECK - 0.07, -0.03);
    g.add(torso, hips, neck, hood);
    if (!flat) {
      var zip = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.5, 0.02), new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.4, metalness: 0.5 }));
      zip.position.set(0, HIP + 0.4, 0.215);
      var pocket = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.02), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.95 }));
      pocket.position.set(0, HIP + 0.2, 0.2);
      g.add(zip, pocket);
    }

    var head = new THREE.Group();
    head.position.y = NECK;
    var faceMat = flat ? top : new THREE.MeshStandardMaterial({ map: faceTexture(skinHex, "calm"), roughness: 0.6 });
    var skull = new THREE.Mesh(new THREE.SphereGeometry(HEAD, 32, 24), faceMat);
    skull.position.y = HEAD + 0.03;
    skull.scale.set(1, 1.06, 1);
    head.add(skull);
    if (!flat) {
      p.face = faceMat;
      var hairMat = new THREE.MeshStandardMaterial({ color: hex(look.hair || HAIR_TONES[0]), roughness: 0.9 });
      var hair = new THREE.Mesh(new THREE.SphereGeometry(HEAD + 0.018, 28, 16, 0, Math.PI * 2, 0, Math.PI * HAIR_COVER), hairMat);
      hair.position.y = HEAD + 0.04;
      hair.rotation.x = -0.5;
      hair.scale.set(1.02, 1.08, 1.04);
      var fringe = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), hairMat);
      fringe.position.set(0.06, HEAD * 2 - 0.03, HEAD * 0.72);
      fringe.scale.set(1.6, 0.6, 0.8);
      var nose = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), skin);
      nose.position.set(0, HEAD + 0.0, HEAD + 0.01);
      head.add(hair, fringe, nose);
      [-1, 1].forEach(function (s) {
        var ear = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), skin);
        ear.position.set(s * HEAD, HEAD + 0.02, -0.01);
        ear.scale.set(0.5, 1, 0.8);
        head.add(ear);
      });
    }
    g.add(head);
    p.head = head;
    return p;
  }
  /** Change a person's expression (calm, tired, happy, sad, shock); a silhouette has no face. */
  function setMood(p, mood) {
    if (!p.face || p.mood === mood) return;
    p.mood = mood;
    p.face.map = faceTexture(p.skinHex, mood);
    p.face.needsUpdate = true;
  }
  /** Pose a person. o.sit; o.y (lift); o.nod (head forward); o.lx/o.rx (shoulders, forward when negative); o.lz/o.rz (arms out
      sideways); o.lb/o.rb (elbow bend, forward when negative); o.ll/o.rl (thigh swing); o.lk/o.rk (knee bend); o.mood. */
  function pose(p, o) {
    var bent = o.sit ? Math.PI / 2 : 0;
    p.legL.rotation.x = o.sit ? -bent : (o.ll || 0);
    p.legR.rotation.x = o.sit ? -bent : (o.rl || 0);
    p.kneeL.rotation.x = o.sit ? bent : (o.lk || 0);
    p.kneeR.rotation.x = o.sit ? bent : (o.rk || 0);
    p.group.position.y = (o.y || 0) + (o.sit ? SEAT_DROP : 0);
    p.head.rotation.x = o.nod || 0;
    p.armL.rotation.set(o.lx || 0, 0, o.lz || 0);
    p.armR.rotation.set(o.rx || 0, 0, o.rz || 0);
    p.elbowL.rotation.x = o.lb === undefined ? ELBOW_REST : o.lb;
    p.elbowR.rotation.x = o.rb === undefined ? ELBOW_REST : o.rb;
    if (o.mood) setMood(p, o.mood);
  }
  /** Both arms up in a cheer, by k in 0..1, with a hop on the beat. */
  function cheer(p, k, t) {
    var hop = Math.abs(Math.sin(t * 6)) * k;
    pose(p, { y: hop * 0.28, nod: -0.2 * k, lz: -ARMS_UP * k, rz: ARMS_UP * k, lb: -0.35 * k, rb: -0.35 * k, lk: hop * 0.5, rk: hop * 0.5, mood: k > 0.3 ? "happy" : undefined });
  }
  /** A walking stride at phase `ph`: opposite legs and a knee that bends on the back swing. */
  function stride(ph) {
    var s = Math.sin(ph);
    return { ll: s * 0.55, rl: -s * 0.55, lk: Math.max(0, -s) * 0.7, rk: Math.max(0, s) * 0.7 };
  }
  /** A rod of the given radius between two points (arrays), for arms and stems. */
  function rod(from, to, radius, mat) {
    var a = v3(from), b = v3(to), m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 12), mat);
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  }
  /** An articulated desk lamp standing at its own origin, aimed at `target` (in the lamp's coordinates): a weighted base, two
      arm sections with joints, a metal shade that is bright inside, a bulb, a soft beam and the pool of light it throws. */
  function deskLamp(target) {
    var g = new THREE.Group(), metal = new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.35, metalness: 0.85 });
    var brass = new THREE.MeshStandardMaterial({ color: 0xc9a25a, roughness: 0.3, metalness: 0.9 });
    var elbow = [-0.1, 0.44, 0], head = [0.24, 0.72, 0.05], aim = v3(target).sub(v3(head)).normalize(), down = new THREE.Vector3(0, -1, 0);
    var base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.035, 28), metal);
    base.position.y = 0.018;
    var collar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.05, 14), brass);
    collar.position.y = 0.06;
    g.add(base, collar, rod([0, 0.06, 0], elbow, 0.016, metal), rod(elbow, head, 0.016, metal));
    [elbow, head].forEach(function (at) {
      var joint = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), brass);
      joint.position.copy(v3(at));
      g.add(joint);
    });
    // the head hangs from the arm's end and points along `aim`; its parts are laid out pointing down, then turned
    var lampHead = new THREE.Group();
    lampHead.position.copy(v3(head));
    lampHead.quaternion.setFromUnitVectors(down, aim);
    var shade = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.17, 0.2, 28, 1, true), metal);
    shade.position.y = -0.11;
    var lining = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.165, 0.2, 28, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe2a8, side: INSIDE_ONLY }));
    lining.position.y = -0.11;
    var cap = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), metal);
    cap.position.y = -0.01;
    var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff4d6 }));
    bulb.position.y = -0.13;
    var reach = v3(target).distanceTo(v3(head));
    var beamGeo = new THREE.CylinderGeometry(0.16, 0.16 + reach * 0.42, reach - 0.2, 28, 1, true);
    var beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffdf9e, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = -0.2 - (reach - 0.2) / 2;
    lampHead.add(shade, lining, cap, bulb, beam);
    var halo = glowSprite(0xffd9a0, 0.7, 0.55);
    halo.position.copy(v3(head)).add(aim.clone().multiplyScalar(0.14));
    var pool = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.002, 36), new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.position.set(target[0], target[1] + 0.03, target[2]);
    var warm = new THREE.PointLight(0xffc98a, LAMP_LIGHT, 0, 2);
    warm.position.copy(v3(head)).add(aim.clone().multiplyScalar(0.3));
    g.add(lampHead, halo, pool, warm);
    return g;
  }
  /** A soft round pool of lamplight: bright in the middle, gone at the edge. */
  function poolTexture() {
    return painted("pool", 256, 256, function (g, w, h) {
      var grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, "rgba(255, 226, 168, 1)"); grad.addColorStop(0.6, "rgba(255, 214, 150, 0.45)"); grad.addColorStop(1, "rgba(255, 214, 150, 0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
  }
  /** The desk set (`who` dresses the person: top, skin, hair; the hero when omitted): a seated builder, a chair, a wooden desk, a lamp, books and a glowing laptop. Returns the group, the builder and the laptop's light. */
  function deskSet(colour, who) {
    var g = new THREE.Group(), p = person(who && who.top || BUILDER, who), metal = new THREE.MeshStandardMaterial({ color: 0x2b333d, roughness: 0.4, metalness: 0.7 });
    var wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7 });
    var top = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.07, 1.15), wood);
    top.position.set(0, 0.98, 0.95);
    g.add(top);
    [[-1.25, 0.45], [1.25, 0.45], [-1.25, 1.45], [1.25, 1.45]].forEach(function (at) {
      var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.95, 10), metal);
      leg.position.set(at[0], 0.475, at[1]);
      g.add(leg);
    });
    var drawer = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.9), wood);
    drawer.position.set(0.9, 0.83, 0.95);
    var seat = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.09, 0.7), std(0x39414d, 0));
    seat.position.set(0, 0.5, 0);
    var back = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.8, 0.08), std(0x39414d, 0));
    back.position.set(0, 1.08, -0.4);
    back.rotation.x = -0.1;
    var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 10), metal);
    stem.position.set(0, 0.25, SEAT_Z);
    var foot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), metal);
    foot.position.set(0, 0.03, SEAT_Z);
    var base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.035, 0.6), new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.35, metalness: 0.8 }));
    base.position.set(0, 1.035, 0.9);
    var keyMap = keyboardTexture();
    var keys = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.58), new THREE.MeshStandardMaterial({ map: keyMap, emissive: WHITE, emissiveMap: keyMap, emissiveIntensity: 0.25, roughness: 0.45, metalness: 0.4 }));
    keys.rotation.x = -Math.PI / 2;
    keys.position.set(0, 1.054, 0.9);
    var lid = new THREE.Group();
    lid.position.set(0, 1.05, 1.2);
    lid.rotation.x = 0.25;
    var shell = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.03), new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.35, metalness: 0.8 }));
    shell.position.y = 0.3;
    var display = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.52), new THREE.MeshBasicMaterial({ map: codeTexture() }));
    display.rotation.y = Math.PI;
    display.position.set(0, 0.3, -0.017);
    var logo = playMark(colour, 0.12);
    logo.position.set(0.01, 0.3, 0.03);
    lid.add(shell, display, logo);
    var lamp = deskLamp([1.1, 0.03, 0.22]);
    lamp.position.set(-1.1, 1.015, 0.58);
    [["#2a6db5", 0.05, "PYTHON"], ["#c2452b", 0.11, "MACHINE LEARNING"], ["#1e7f5c", 0.17, "SQL"]].forEach(function (b, i) {
      var book = new THREE.Group(), wide = 0.42 - i * 0.04;
      var block = new THREE.Mesh(new THREE.BoxGeometry(wide, 0.055, 0.3), std(hex(b[0]), 0.1));
      var spine = new THREE.Mesh(new THREE.PlaneGeometry(wide, 0.055), new THREE.MeshStandardMaterial({ map: spineTexture(b[2], b[0], false), roughness: 0.7 }));
      spine.position.z = 0.151;
      book.add(block, spine);
      book.position.set(0.95, 1.015 + b[1] - 0.02, 1.2);
      book.rotation.y = 0.2 - i * 0.18;
      g.add(book);
    });
    var light = new THREE.PointLight(colour, SCREEN_GLOW, 0, 2);
    light.position.set(0, 1.5, 0.7);
    var glow = glowSprite(colour, 1.6, 0.1);
    glow.position.set(0, 1.4, 1.0);
    var swivel = new THREE.Group();
    swivel.position.z = SEAT_Z;
    swivel.add(seat, back, p.group);
    g.add(drawer, swivel, stem, foot, base, keys, lid, lamp, light, glow);
    return { group: g, builder: p, light: light, glow: glow, display: display, swivel: swivel };
  }
  /** Falling confetti in one colour: points in a box above the stage, moved by absolute time. */
  function confetti(count, seed, colour) {
    var r = rng(seed), pos = [];
    for (var i = 0; i < count; i++) pos.push((r() - 0.5) * 18, r() * 9, (r() - 0.5) * 14);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    var pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: colour, map: dot(), size: 0.2, transparent: true, opacity: 0.95, depthWrite: false }));
    pts.userData.base = pos.slice();
    return pts;
  }
  function moveConfetti(pts, t) {
    var a = pts.geometry.attributes.position, b = pts.userData.base;
    for (var i = 0; i < a.count; i++) {
      a.array[i * 3 + 1] = ((b[i * 3 + 1] - t * 1.7) % 9 + 9) % 9;
      a.array[i * 3] = b[i * 3] + Math.sin(t * 1.3 + i) * 0.35;
    }
    a.needsUpdate = true;
  }

  /* --- act one: the builder's pain --- */

  /** A coffee mug: an open cup you can see into, a base, a handle on its +x side and coffee inside. Cream when no colour is given. */
  function coffeeMug(colour) {
    var mug = new THREE.Group(), glaze = new THREE.MeshStandardMaterial({ color: colour || 0xe9e2d5, roughness: 0.35, side: THREE.DoubleSide });
    var cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.2, 28, 1, true), glaze);
    var base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.012, 28), glaze);
    base.position.y = -0.094;
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.008, 8, 28), glaze);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.1;
    var handle = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.016, 10, 20, Math.PI * 1.2), glaze);
    handle.rotation.z = -Math.PI * 0.6;
    handle.position.x = 0.088;
    var coffee = new THREE.Mesh(new THREE.CylinderGeometry(0.084, 0.082, 0.004, 28), new THREE.MeshBasicMaterial({ color: 0x2c1a10 }));
    coffee.position.y = 0.06;
    mug.add(cup, base, rim, handle, coffee);
    return mug;
  }

  /** A small office: carpet, four walls that only show from inside (so a camera outside looks in, as into a film set), a door,
      skirting, a bookshelf, a plant, a waste bin with crumpled paper, a PC tower and a ceiling light. The back wall is at WALL_Z. */
  function officeRoom(wallColour) {
    var g = new THREE.Group(), paint = new THREE.MeshStandardMaterial({ color: wallColour || 0x33404f, roughness: 0.95 });
    var midZ = (WALL_Z + ROOM_FRONT) / 2, depth = ROOM_FRONT - WALL_Z, trim = std(0xd8dde3, 0.03), wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7 });
    var carpet = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, depth), new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 1 }));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, 0.01, midZ);
    g.add(carpet);
    // [x, z, turn, width]: each wall is a plane facing into the room
    [[0, WALL_Z - 0.02, 0, ROOM_HALF * 2], [-ROOM_HALF, midZ, Math.PI / 2, depth], [ROOM_HALF, midZ, -Math.PI / 2, depth], [0, ROOM_FRONT, Math.PI, ROOM_HALF * 2]].forEach(function (w) {
      var wall = new THREE.Mesh(new THREE.PlaneGeometry(w[3], ROOM_HEIGHT), paint);
      wall.position.set(w[0], ROOM_HEIGHT / 2, w[1]);
      wall.rotation.y = w[2];
      wall.userData.noCast = true;
      var skirting = new THREE.Mesh(new THREE.PlaneGeometry(w[3], 0.16), trim);
      skirting.position.set(w[0] + Math.sin(w[2]) * 0.01, 0.08, w[1] + Math.cos(w[2]) * 0.01);
      skirting.rotation.y = w[2];
      skirting.userData.noCast = true;
      g.add(wall, skirting);
    });
    // the door and its handle are flat and face inwards too, so they vanish with the front wall when the camera is outside
    var door = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.9), wood);
    door.position.set(2.6, 1.45, ROOM_FRONT - 0.02);
    door.rotation.y = Math.PI;
    var knob = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), std(0xd9b45a, 0.3));
    knob.position.set(2.1, 1.4, ROOM_FRONT - 0.03);
    knob.rotation.y = Math.PI;
    door.userData.noCast = knob.userData.noCast = true;
    g.add(door, knob);
    // a bookshelf on the left wall
    var shelf = new THREE.Group(), r = rng(47), shelved = 0;
    [-0.44, 0.44].forEach(function (x) {
      var upright = new THREE.Mesh(new THREE.BoxGeometry(0.05, 3.2, 0.4), wood);
      upright.position.set(x, 1.6, 0);
      shelf.add(upright);
    });
    for (var level = 0; level < 5; level++) {
      var board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.4), wood);
      board.position.set(0, 0.03 + level * 0.78, 0);
      shelf.add(board);
      if (level === 4) continue;
      var at = -0.38;
      while (at < 0.32) {
        var thick = 0.085 + r() * 0.05, tall = 0.44 + r() * 0.22, cover = SPINE_COLOURS[Math.floor(r() * SPINE_COLOURS.length)];
        if (at + thick > 0.41) break;
        var book = new THREE.Mesh(new THREE.BoxGeometry(thick, tall, 0.28), std(hex(cover), 0.08));
        book.position.set(at + thick / 2, 0.055 + level * 0.78 + tall / 2, 0);
        // the title runs up the spine, the face of the book that looks into the room
        var spine = new THREE.Mesh(new THREE.PlaneGeometry(thick, tall), new THREE.MeshStandardMaterial({ map: spineTexture(BOOK_TITLES[shelved % BOOK_TITLES.length], cover, true), roughness: 0.7 }));
        spine.position.set(book.position.x, book.position.y, 0.141);
        shelved++;
        shelf.add(book, spine);
        at += thick + 0.008;
      }
    }
    shelf.rotation.y = Math.PI / 2;
    shelf.position.set(-ROOM_HALF + 0.22, 0, 1.2);
    g.add(shelf);
    // a plant in the back corner
    var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.42, 18), std(0xb5673d, 0.05));
    pot.position.set(-ROOM_HALF + 0.7, 0.21, WALL_Z + 0.7);
    g.add(pot);
    for (var leaf = 0; leaf < 7; leaf++) {
      var blade = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), std(0x2f7d4f, 0.12));
      blade.scale.set(0.45, 1.5, 0.2);
      blade.position.set(pot.position.x + Math.cos(leaf * 0.9) * 0.16, 0.75 + (leaf % 3) * 0.13, pot.position.z + Math.sin(leaf * 0.9) * 0.16);
      blade.rotation.set(Math.sin(leaf * 0.9) * 0.5, leaf * 0.9, -Math.cos(leaf * 0.9) * 0.5);
      g.add(blade);
    }
    // a bin with crumpled drafts, and the PC under the desk
    var bin = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.19, 0.5, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0x4a5564, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }));
    bin.position.set(2.0, 0.25, 1.1);
    g.add(bin);
    [[2.0, 0.42, 1.1], [1.93, 0.5, 1.16], [2.42, 0.08, 1.35], [1.72, 0.08, 1.6]].forEach(function (at2, i) {
      var ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), std(0xeef1f4, 0.05));
      ball.position.set(at2[0], at2[1], at2[2]);
      ball.rotation.set(i, i * 2, 0);
      g.add(ball);
    });
    var tower = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.55, 0.55), std(0x1a222c, 0));
    tower.position.set(-0.95, 0.28, 1.0);
    var led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), std(0x39e58c, 2.5));
    led.position.set(-0.95, 0.46, 0.72);
    var ceiling = new THREE.PointLight(0xffe3c2, 26, 0, 2);
    ceiling.position.set(0.5, ROOM_HEIGHT - 0.6, 2.2);
    g.add(tower, led, ceiling);
    return g;
  }
  /** The layers of the view through the office window, each painted once: "night" (stars over a deep sky), "day" (blue with
      clouds), "dawn" (the warm band of sunrise and sunset), "skyline" (rooftops, see-through above them), "lights" (their lit
      windows, for the night) and "patch" (four panes of sunlight, for the floor). */
  function skyTexture(kind) {
    return painted("sky-" + kind, 520, 380, function (g, w, h) {
      var r = rng(kind === "lights" || kind === "skyline" ? 12 : 13), grad = g.createLinearGradient(0, 0, 0, h), i;
      if (kind === "night") {
        grad.addColorStop(0, "#050b1c"); grad.addColorStop(0.7, "#12254a"); grad.addColorStop(1, "#243a66");
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        for (i = 0; i < 90; i++) { g.fillStyle = "rgba(255, 255, 255, " + (0.3 + r() * 0.7) + ")"; g.fillRect(r() * w, r() * h * 0.75, 1 + r() * 2, 1 + r() * 2); }
      } else if (kind === "day") {
        grad.addColorStop(0, "#4f9be0"); grad.addColorStop(0.75, "#a8d4f5"); grad.addColorStop(1, "#dcefff");
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        g.fillStyle = "rgba(255, 255, 255, 0.85)";
        for (i = 0; i < 5; i++) {
          var cx = 40 + r() * (w - 80), cy = 40 + r() * 150;
          for (var puff = 0; puff < 5; puff++) { g.beginPath(); g.ellipse(cx + puff * 22 - 44, cy + (puff % 2) * 8, 30, 16, 0, 0, Math.PI * 2); g.fill(); }
        }
      } else if (kind === "dawn") {
        grad.addColorStop(0, "rgba(255, 150, 90, 0)"); grad.addColorStop(0.55, "rgba(255, 140, 80, 0.55)"); grad.addColorStop(1, "rgba(255, 196, 110, 0.95)");
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
      } else if (kind === "patch") {
        g.fillStyle = "#fff0c8";
        [[20, 20], [w / 2 + 12, 20], [20, h / 2 + 12], [w / 2 + 12, h / 2 + 12]].forEach(function (at) { g.fillRect(at[0], at[1], w / 2 - 32, h / 2 - 32); });
      } else {
        var x = 0;
        while (x < w) {
          var bw = 34 + r() * 46, bh = 70 + r() * 130;
          if (kind === "skyline") { g.fillStyle = "#0e1622"; g.fillRect(x, h - bh, bw, bh); }
          for (var wy = h - bh + 10; wy < h - 8; wy += 16) {
            for (var wx = x + 6; wx < x + bw - 8; wx += 12) {
              // both layers draw the same numbers in the same order, so every lit window sits on its own building
              var on = r() < 0.4, warm = r() < 0.7;
              if (kind === "lights" && on) { g.fillStyle = warm ? "#ffd98a" : "#9fd0ff"; g.fillRect(wx, wy, 6, 8); }
            }
          }
          x += bw + 2;
        }
      }
    });
  }
  /** A book's spine in its cover colour with the title in a contrasting ink and two thin bands; `upright` turns the title to run
      up a standing book, otherwise it reads along a book lying flat. */
  function spineTexture(title, cover, upright) {
    return painted("spine-" + title + cover + upright, upright ? 96 : 512, upright ? 512 : 64, function (g, w, h) {
      var long = Math.max(w, h), short = Math.min(w, h), ink = cover === "#e8edf2" || cover === "#d98a0a" ? "#14181d" : "#ffffff", size = short * 0.52;
      g.fillStyle = cover;
      g.fillRect(0, 0, w, h);
      if (upright) { g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2); g.translate(-h / 2, -w / 2); }
      g.fillStyle = ink;
      g.globalAlpha = 0.6;
      g.fillRect(long * 0.06, short * 0.18, 4, short * 0.64);
      g.fillRect(long * 0.94 - 4, short * 0.18, 4, short * 0.64);
      g.globalAlpha = 1;
      g.textAlign = "center"; g.textBaseline = "middle";
      do {
        g.font = "700 " + size + "px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif";
        size -= 2;
      } while (g.measureText(title).width > long * 0.8 && size > 10);
      g.fillText(title, long / 2, short / 2 + 2);
    });
  }
  /** Office carpet: a dark weave with faint flecks. */
  function carpetTexture() {
    return painted("carpet", 512, 512, function (g, w, h) {
      var r = rng(29);
      g.fillStyle = "#2b3140";
      g.fillRect(0, 0, w, h);
      for (var i = 0; i < 9000; i++) {
        g.fillStyle = r() < 0.5 ? "rgba(255, 255, 255, 0.045)" : "rgba(0, 0, 0, 0.12)";
        g.fillRect(r() * w, r() * h, 2, 2);
      }
    });
  }

  builders.night = function (sc) {
    var g = new THREE.Group(), set = deskSet(hex(sc.colour)), days = [], hero = set.builder;
    g.add(set.group);
    g.add(officeRoom());
    // the window: three days and nights pass outside while the work goes on
    var view = new THREE.Group();
    view.position.set(WINDOW_X, WINDOW_Y, WALL_Z);
    g.add(view);
    /** One layer of the view through the window, `depth` in front of the wall. */
    function pane(texture, depth, opacity) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_W, WINDOW_H), new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: opacity, depthWrite: false }));
      m.position.z = depth;
      m.renderOrder = Math.round(depth * 1000);
      view.add(m);
      return m;
    }
    var nightSky = pane(skyTexture("night"), 0, 1), daySky = pane(skyTexture("day"), 0.002, 0), glowSky = pane(skyTexture("dawn"), 0.004, 0);
    function disc(colour, radius) {
      var m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.002, 32), new THREE.MeshBasicMaterial({ color: colour, transparent: true, depthWrite: false }));
      m.rotation.x = Math.PI / 2;
      m.renderOrder = 6;
      view.add(m);
      return m;
    }
    var sun = disc(0xffe08a, 0.17), moon = disc(0xe6eefc, 0.13);
    var skyline = pane(skyTexture("skyline"), 0.008, 1), cityLights = pane(skyTexture("lights"), 0.01, 1);
    // sunlight through the four panes, lying on the carpet
    var sunPatch = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.6), new THREE.MeshBasicMaterial({ map: skyTexture("patch"), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    sunPatch.rotation.x = -Math.PI / 2;
    g.add(sunPatch);
    [[0, 0.98, 2.8, 0.1], [0, -0.98, 2.8, 0.1], [-1.35, 0, 0.1, 2.06], [1.35, 0, 0.1, 2.06], [0, 0, 0.06, 1.9], [0, 0, 2.6, 0.06]].forEach(function (b) {
      var bar = new THREE.Mesh(new THREE.BoxGeometry(b[2], b[3], 0.08), std(0xd8dde3, 0.05));
      bar.position.set(WINDOW_X + b[0], WINDOW_Y + b[1], WALL_Z + 0.05);
      g.add(bar);
    });
    var daylight = new THREE.PointLight(DAY_SKY, 0, 0, 2);
    daylight.position.set(WINDOW_X, WINDOW_Y, WALL_Z + 1.4);
    g.add(daylight);
    // the wall clock: its hands race
    var clockAt = [0.3, 4.2, WALL_Z + 0.05];
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 10, 40), std(0xd8dde3, 0.1));
    var dial = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 40), std(0xf4f6f8, 0.25));
    dial.rotation.x = Math.PI / 2;
    var minute = new THREE.Group(), hour = new THREE.Group();
    var minuteHand = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.42, 0.02), std(0x1a222c, 0));
    minuteHand.position.y = 0.2;
    var hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.02), std(0xc2452b, 0.3));
    hourHand.position.y = 0.13;
    minute.add(minuteHand); hour.add(hourHand);
    [rim, dial, minute, hour].forEach(function (part, i) { part.position.set(clockAt[0], clockAt[1], clockAt[2] + (i > 1 ? 0.03 + i * 0.01 : 0)); g.add(part); });
    // the calendar: three weeks, one tile lit per night
    for (var i = 0; i < CALENDAR_DAYS; i++) {
      var tile = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.05), std(0x1f2832, 0));
      tile.position.set(2.2 + (i % 7) * 0.44, 4.1 - Math.floor(i / 7) * 0.44, WALL_Z + 0.03);
      g.add(tile); days.push(tile);
    }
    // the mug in use: it rests where the reaching hand closes on its handle, and follows that hand while it is held
    var sip = coffeeMug(MUG_IN_USE), wrist = new THREE.Vector3(), rest = new THREE.Vector3(), offset = new THREE.Vector3();
    var armTurn = new THREE.Quaternion(), tilt = new THREE.Quaternion(), hold = new THREE.Quaternion(), X_AXIS = new THREE.Vector3(1, 0, 0);
    // the character faces +z, so its right hand is the one at -x (named armL: the names are by screen side). Holding the handle
    // from that side: the fingers point forward (+z), the palm faces the mug (+x), and the mug's handle is turned to -x
    var gripTurn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)));
    var handleTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    g.add(sip);
    /** The sipping (right) hand's wrist in this scene's coordinates, for the pose just set. */
    function wristNow(into) {
      hero.group.updateMatrixWorld(true);
      hero.handL.getWorldPosition(into);
      return g.worldToLocal(into);
    }
    g.updateMatrixWorld(true);
    // bend the reaching elbow until the wrist is exactly at the height of the handle, so the mug never slides in the hand
    var reachBend = REACH.bend, low = REACH.bend - 0.6, high = REACH.bend + 0.6, reachWrist = new THREE.Vector3();
    for (var step = 0; step < 24; step++) {
      reachBend = (low + high) / 2;
      pose(hero, { sit: true, lx: REACH.x, lb: reachBend, lz: REACH.z });
      // a straighter elbow (a larger angle) lowers the wrist
      if (wristNow(reachWrist).y > MUG_ON_DESK) low = reachBend;
      else high = reachBend;
    }
    rest.copy(reachWrist).add(v3(MUG_GRIP));
    rest.y = MUG_ON_DESK;
    var screen = codeTexture().clone();
    screen.wrapT = REPEAT_WRAPPING;
    screen.needsUpdate = true;
    set.display.material.map = screen;
    var d = dust(200, 3, 0x8fbbe0);
    g.add(d);
    return {
      group: g,
      floor: false,
      accent: 0,
      shots: [
        { at: 0, from: [-2.4, 2.7, 1.5], to: [5.4, 3.3, 8], look: [-5.2, 2.95, 1.2], lookTo: [0, 2.3, 0], ease: 2.6 },   // the bookshelf, then out to the room
        { at: 0.32, from: [-1.1, 2.5, -1.3], to: [-0.7, 2.3, -0.9], look: [0.15, 2.05, 1.2] },  // over the shoulder: the code
        { at: 0.52, from: [1.9, 2.5, 3.4], to: [1.2, 2.45, 2.8], look: [0, 2.4, 0.3] },         // the face: tired, another coffee
        { at: 0.78, from: [-4.5, 3.4, 6.5], to: [-3.2, 3.9, 5.6], look: [0.6, 2.9, -0.8] }      // the wall: the nights add up
      ],
      update: function (u, t) {
        var lit = smooth(span(u, 0.05, 0.95)) * CALENDAR_DAYS, bright = 0.5 - 0.5 * Math.cos(u * Math.PI * 2 * DAY_CYCLES);
        days.forEach(function (tile, i) {
          var on = i < lit;
          tile.material.color.setHex(on ? AMBER : 0x1f2832);
          tile.material.emissive.setHex(on ? AMBER : 0x000000);
          tile.material.emissiveIntensity = on ? 0.9 : 0;
        });
        // the sun is highest when `bright` is 1 and the moon when it is 0; each crosses the window on an arc and sets behind the skyline
        var sunHour = u * Math.PI * 2 * DAY_CYCLES - Math.PI;
        [[sun, sunHour], [moon, sunHour + Math.PI]].forEach(function (body) {
          var y = -WINDOW_H / 2 - 0.1 + Math.cos(body[1]) * (WINDOW_H * 0.82);
          body[0].position.set(Math.sin(body[1]) * (WINDOW_W / 2 - 0.25), y, 0.006);
          body[0].visible = y > -WINDOW_H / 2 + 0.05;
        });
        daySky.material.opacity = bright;
        glowSky.material.opacity = 0.85 * Math.sin(bright * Math.PI);
        cityLights.material.opacity = 1 - smooth(span(bright, 0.2, 0.6));
        sunPatch.material.opacity = 0.42 * smooth(span(bright, 0.35, 0.9));
        sunPatch.position.set(WINDOW_X - Math.sin(sunHour) * 1.5, 0.03, WALL_Z + 2.3 + (1 - bright) * 1.2);
        sunPatch.rotation.z = Math.sin(sunHour) * 0.35;
        daylight.intensity = 22 * bright;
        minute.rotation.z = -u * Math.PI * 2 * CLOCK_TURNS;
        hour.rotation.z = -u * Math.PI * 2 * CLOCK_TURNS / 12;
        screen.offset.y = t * 0.12;
        var reach = smooth(span(u, 0.5, 0.56)) * (1 - smooth(span(u, 0.74, 0.79)));
        var drink = smooth(span(u, 0.57, 0.63)) * (1 - smooth(span(u, 0.68, 0.74)));
        var stretch = Math.sin(Math.PI * span(u, 0.82, 0.99)), typing = (1 - stretch) * (1 - reach);
        pose(hero, {
          sit: true, mood: "tired",
          nod: lerp(0.18 + 0.12 * Math.sin(t * 0.9), -0.45, Math.max(stretch, drink * 0.4)),
          rx: lerp(TYPING, 0, stretch), rz: ARMS_UP * stretch, rb: lerp(TYPING_ELBOW + Math.sin(t * 19) * 0.1, -0.3, stretch),
          lx: lerp(lerp(lerp(TYPING, REACH.x, reach), SIP.x, drink), 0, stretch),
          lz: lerp(lerp(REACH.z * reach, SIP.z, drink), -ARMS_UP, stretch),
          lb: lerp(lerp(lerp(TYPING_ELBOW + Math.cos(t * 19) * 0.1 * typing, reachBend, reach), SIP.bend, drink), -0.3, stretch)
        });
        // the wrist turns to the handle as the hand arrives, the fingers close, and the mug then travels with the wrist
        tilt.setFromAxisAngle(X_AXIS, -SIP_TILT * drink);
        hold.copy(tilt).multiply(gripTurn);
        hero.elbowL.getWorldQuaternion(armTurn);
        hero.handL.quaternion.identity().slerp(armTurn.invert().multiply(hold), reach);
        closeHand(hero.handL, HANDLE_CURL * smooth(span(reach, 0.6, 1)));
        tapFingers(hero.handR, t, 1 - stretch);
        if (reach < 0.05) tapFingers(hero.handL, t, 1 - stretch);
        wristNow(wrist);
        offset.copy(v3(MUG_GRIP)).applyQuaternion(tilt);
        // held: the mug is rigid in the hand, at the wrist plus the grip offset, turning with the wrist as it tips
        sip.position.copy(wrist).add(offset);
        sip.position.lerpVectors(rest, sip.position, smooth(span(reach, 0.9, 1)));
        sip.quaternion.copy(tilt).multiply(handleTurn);
        set.light.intensity = SCREEN_GLOW * (1 + Math.sin(t * 11) * 0.15);
        moveDust(d, t);
      }
    };
  };

  /** A screenful of finished work, one per kind of project: "app" (a web app), "report" (a dashboard report), "deck" (a slide). */
  function workTexture(kind) {
    return painted("work-" + kind, 512, 320, function (g, w, h) {
      var i, bold = "700 34px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif";
      g.textBaseline = "middle";
      if (kind === "app") {
        g.fillStyle = "#f4f6f8"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#0e7c86"; g.fillRect(0, 0, w, 54);
        g.fillStyle = "#ffffff"; g.font = bold; g.fillText(tx("workApp", "MY APP"), 22, 29);
        var hero = g.createLinearGradient(0, 70, w, 170);
        hero.addColorStop(0, "#5fc5cf"); hero.addColorStop(1, "#2a6db5");
        g.fillStyle = hero; g.fillRect(22, 70, w - 44, 100);
        g.fillStyle = "#ffffff"; g.fillRect(44, 100, 190, 14); g.fillRect(44, 126, 130, 10);
        for (i = 0; i < 3; i++) { g.fillStyle = "#ffffff"; g.fillRect(22 + i * 160, 186, 148, 76); g.fillStyle = "#c9d2dc"; g.fillRect(34 + i * 160, 200, 90, 10); g.fillRect(34 + i * 160, 220, 124, 8); }
        g.fillStyle = "#b4620f"; g.fillRect(w - 170, 274, 148, 34);
      } else if (kind === "report") {
        g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#172029"; g.font = bold; g.fillText(tx("workReport", "Q3 REPORT"), 22, 32);
        [["#2a6db5", "128"], ["#1e7f5c", "94%"], ["#b4620f", "4.2"]].forEach(function (k, n) {
          g.fillStyle = "#e8edf2"; g.fillRect(22 + n * 160, 62, 148, 62);
          g.fillStyle = k[0]; g.font = bold; g.fillText(k[1], 36 + n * 160, 94);
        });
        [0.45, 0.62, 0.5, 0.78, 0.7, 0.92, 0.84].forEach(function (v, n) { g.fillStyle = n % 2 ? "#6a4bb5" : "#2a6db5"; g.fillRect(34 + n * 66, 300 - v * 150, 44, v * 150); });
        g.strokeStyle = "#b4620f"; g.lineWidth = 5; g.beginPath();
        [0.3, 0.42, 0.4, 0.58, 0.66, 0.74, 0.9].forEach(function (v, n) { g[n ? "lineTo" : "moveTo"](56 + n * 66, 300 - v * 160); });
        g.stroke();
      } else {
        g.fillStyle = "#1b2430"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#f2c14e"; g.font = "700 46px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif"; g.fillText(tx("workDeck", "PITCH DECK"), 26, 52);
        for (i = 0; i < 4; i++) { g.fillStyle = "#f2c14e"; g.beginPath(); g.arc(40, 118 + i * 44, 7, 0, Math.PI * 2); g.fill(); g.fillStyle = "#d6dde6"; g.fillRect(62, 111 + i * 44, 170 + (i % 2) * 50, 13); }
        [["#5fc5cf", 0, 2.3], ["#ef8578", 2.3, 4.4], ["#b39ded", 4.4, 6.283]].forEach(function (s2) { g.fillStyle = s2[0]; g.beginPath(); g.moveTo(396, 190); g.arc(396, 190, 84, s2[1], s2[2]); g.closePath(); g.fill(); });
      }
    });
  }
  /** The moment after: a green tick and the word (PUBLISHED, SENT, SHARED). */
  function doneTexture(word) {
    return painted("done-" + word, 512, 320, function (g, w, h) {
      g.fillStyle = "#0f1a14"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#39c27d"; g.beginPath(); g.arc(w / 2, 124, 70, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#ffffff"; g.lineWidth = 16; g.lineCap = "round"; g.lineJoin = "round";
      g.beginPath(); g.moveTo(w / 2 - 34, 126); g.lineTo(w / 2 - 8, 152); g.lineTo(w / 2 + 38, 98); g.stroke();
      g.fillStyle = "#ffffff"; g.font = "700 50px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(word, w / 2, 254);
    });
  }
  /** What comes back: a big zero, what it counts (VIEWS, OPENS, REPLIES) and a flat line. */
  function zeroTexture(label) {
    return painted("zero-" + label, 512, 320, function (g, w, h) {
      g.fillStyle = "#14181d"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#ff8f80"; g.font = "700 190px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("0", 150, 150);
      g.fillStyle = "#d6dde6"; g.font = "700 54px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif"; g.textAlign = "left";
      g.fillText(label, 262, 136);
      g.strokeStyle = "#5b6673"; g.lineWidth = 6; g.beginPath(); g.moveTo(40, 276); g.lineTo(w - 40, 276); g.stroke();
      g.fillStyle = "#5b6673"; for (var i = 0; i < 8; i++) { g.beginPath(); g.arc(40 + i * (w - 80) / 7, 276, 8, 0, Math.PI * 2); g.fill(); }
    });
  }

  builders.ship = function (sc) {
    var g = new THREE.Group(), stations = STATIONS.map(function (st, i) {
      var room = officeRoom(st.wall), set = deskSet(hex(sc.colour), st.who), board = new THREE.Group();
      // a wall screen: the work while it is being made, the numbers once it is out
      var bezel = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.86, 0.08), std(0x14181d, 0));
      var face = new THREE.Mesh(new THREE.PlaneGeometry(2.74, 1.7), new THREE.MeshBasicMaterial({ map: workTexture(st.kind) }));
      face.position.z = 0.045;
      board.add(bezel, face);
      board.position.set(2.2, 3.3, WALL_Z + 0.05);
      var bay = new THREE.Group();
      bay.add(room, set.group, board);
      bay.position.x = st.x;
      g.add(bay);
      return { set: set, face: face, st: st, press: PRESS_AT[i] };
    });
    /** The two shots of one station: over the shoulder to read the screen, then the face. */
    function pair(i, from, cut) {
      var x = STATIONS[i].x;
      return [
        { at: from, from: [x - 1.1, 2.5, -1.3], to: [x - 0.75, 2.3, -0.95], look: [x + 0.15, 2.05, 1.2] },
        { at: cut, from: [x + 1.9, 2.5, 3.4], to: [x + 1.3, 2.45, 2.9], look: [x, 2.4, 0.3] }
      ];
    }
    return {
      group: g,
      floor: false,
      accent: 0,
      shots: pair(0, 0, 0.15).concat(pair(1, 0.25, 0.4), pair(2, 0.48, 0.63), [
        { at: SILENCE_AT - 0.04, from: [-11.5, 3.1, 9.5], to: [11.5, 3.1, 9.5], look: [-11.5, 2.9, 0], lookTo: [11.5, 2.9, 0] }   // along all three rooms
      ]),
      update: function (u, t) {
        stations.forEach(function (s) {
          var out = u >= s.press, quiet = u >= SILENCE_AT;
          var screen = quiet ? zeroTexture(tx("count" + s.st.kind, s.st.count)) : out ? doneTexture(tx("done" + s.st.kind, s.st.done)) : workTexture(s.st.kind);
          if (s.set.display.material.map !== screen) { s.set.display.material.map = screen; s.set.display.material.needsUpdate = true; }
          var wall = quiet ? zeroTexture(tx("count" + s.st.kind, s.st.count)) : workTexture(s.st.kind);
          if (s.face.material.map !== wall) { s.face.material.map = wall; s.face.material.needsUpdate = true; }
          var tap = Math.sin(Math.PI * span(u, s.press - 0.03, s.press + 0.01)), joy = smooth(span(u, s.press, s.press + 0.04)), sad = smooth(span(u, SILENCE_AT + 0.02, SILENCE_AT + 0.12));
          var typing = 1 - smooth(span(u, s.press - 0.04, s.press - 0.03)), up = joy * (1 - sad);
          pose(s.set.builder, {
            sit: true, mood: sad > 0.4 ? "sad" : joy > 0.3 ? "happy" : "calm",
            nod: lerp(lerp(0.15, -0.25, up), 0.75, sad),
            lx: lerp(TYPING, -0.15, Math.max(up, sad)), lz: -ARMS_UP * 0.92 * up, lb: lerp(TYPING_ELBOW - 0.45 * tap, -0.45, Math.max(up, sad)),
            rx: lerp(TYPING, -0.15, Math.max(up, sad)), rz: ARMS_UP * 0.92 * up, rb: lerp(TYPING_ELBOW, -0.45, Math.max(up, sad))
          });
          tapFingers(s.set.builder.handL, t + s.st.x, typing);
          tapFingers(s.set.builder.handR, t + s.st.x, typing);
          s.set.light.intensity = lerp(SCREEN_GLOW, SCREEN_GLOW * 0.45, sad);
        });
      }
    };
  };

  /** What gets shown in the meeting, one screenful per kind: "page" (a very long wiki page, three screens tall, to scroll),
      "slide" (a dense slide, 14 of 87), "flow" (a flow diagram) and "sequence" (a sequence diagram). */
  function boringTexture(kind) {
    var tall = kind === "page";
    return painted("boring-" + kind, 768, tall ? 1440 : 480, function (g, w, h) {
      var r = rng(kind.length * 7), bold = "700 30px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif", i, y;
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
      g.textBaseline = "middle"; g.fillStyle = "#172029";
      if (kind === "page") {
        g.fillStyle = "#e8edf2"; g.fillRect(0, 0, w, 44);
        g.fillStyle = "#5b6673"; g.font = "600 20px 'Source Sans 3', system-ui, sans-serif"; g.fillText(tx("pagePath", "Wiki  /  Projects  /  Design notes  /  v7 (draft)"), 20, 23);
        y = 70;
        for (var section = 0; section < 9; section++) {
          g.fillStyle = "#172029"; g.font = bold; g.fillText((section + 1) + ".  " + ["Background", "Scope", "Assumptions", "Dependencies", "Architecture", "Data flow", "Open questions", "Risks", "Appendix"][section], 28, y + 14);
          y += 44;
          for (i = 0; i < 9; i++) { g.fillStyle = "#aeb7c1"; g.fillRect(28, y, i === 8 ? 300 + r() * 200 : w - 56 - r() * 40, 7); y += 12; }
          y += 12;
        }
      } else if (kind === "slide") {
        g.font = bold; g.fillText(tx("slideTitle", "Architecture overview (continued)"), 36, 48);
        for (i = 0; i < 9; i++) {
          g.fillStyle = "#172029"; g.beginPath(); g.arc(48, 110 + i * 36, 5, 0, Math.PI * 2); g.fill();
          g.fillStyle = "#8d96a0"; g.fillRect(66, 105 + i * 36, 420 + r() * 230, 9);
          if (i % 2) g.fillRect(66, 119 + (i - 1) * 36 + 36, 280 + r() * 200, 6);
        }
        g.fillStyle = "#5b6673"; g.font = "600 22px 'Source Sans 3', system-ui, sans-serif"; g.textAlign = "right"; g.fillText(tx("slideCount", "Slide 14 of 87"), w - 30, h - 28);
      } else if (kind === "flow") {
        g.font = bold; g.fillText(tx("flowTitle", "Process flow (1 of 6)"), 36, 40);
        g.strokeStyle = "#5b6673"; g.lineWidth = 3; g.fillStyle = "#e8edf2";
        var nodes = [];
        for (var row = 0; row < 3; row++) for (var col = 0; col < 5; col++) nodes.push([60 + col * 138, 90 + row * 125]);
        nodes.forEach(function (n, k) {
          if (k % 5 < 4) { g.beginPath(); g.moveTo(n[0] + 100, n[1] + 30); g.lineTo(n[0] + 138, n[1] + 30); g.stroke(); }
          if (k < 10 && k % 2) { g.beginPath(); g.moveTo(n[0] + 50, n[1] + 60); g.lineTo(n[0] + 50, n[1] + 125); g.stroke(); }
        });
        nodes.forEach(function (n, k) {
          g.fillStyle = "#e8edf2";
          if (k % 4 === 2) { g.beginPath(); g.moveTo(n[0] + 50, n[1] - 6); g.lineTo(n[0] + 106, n[1] + 30); g.lineTo(n[0] + 50, n[1] + 66); g.lineTo(n[0] - 6, n[1] + 30); g.closePath(); g.fill(); g.stroke(); }
          else { g.fillRect(n[0], n[1], 100, 60); g.strokeRect(n[0], n[1], 100, 60); }
          g.fillStyle = "#aeb7c1"; g.fillRect(n[0] + 20, n[1] + 26, 60, 7);
        });
      } else {
        g.font = bold; g.fillText(tx("seqTitle", "Sequence diagram (3 of 9)"), 36, 40);
        g.strokeStyle = "#5b6673"; g.lineWidth = 3;
        for (i = 0; i < 6; i++) {
          g.fillStyle = "#e8edf2"; g.fillRect(40 + i * 122, 76, 96, 40); g.strokeRect(40 + i * 122, 76, 96, 40);
          g.setLineDash([8, 6]); g.beginPath(); g.moveTo(88 + i * 122, 116); g.lineTo(88 + i * 122, h - 20); g.stroke(); g.setLineDash([]);
        }
        for (i = 0; i < 11; i++) {
          var from = Math.floor(r() * 6), to = (from + 1 + Math.floor(r() * 4)) % 6;
          y = 140 + i * 29;
          g.beginPath(); g.moveTo(88 + from * 122, y); g.lineTo(88 + to * 122, y); g.stroke();
          g.fillStyle = "#5b6673"; g.beginPath(); g.arc(88 + to * 122, y, 6, 0, Math.PI * 2); g.fill();
        }
      }
    });
  }
  /** What is on a distracted person's screen: "feed" (a scrolling feed of posts), "chat" (message bubbles), "inbox" (a mail list)
      or "video" (a clip playing). `tall` paints it portrait, for a phone. */
  function screenTexture(kind, tall) {
    return painted("screen-" + kind + tall, tall ? 256 : 512, tall ? 512 : 320, function (g, w, h) {
      var r = rng(kind.length * 13 + (tall ? 1 : 0)), i, y;
      g.fillStyle = kind === "video" ? "#0b1017" : "#f4f6f8"; g.fillRect(0, 0, w, h);
      if (kind === "feed") {
        for (y = 14; y < h; y += 150) {
          g.fillStyle = "#ffffff"; g.fillRect(12, y, w - 24, 138);
          g.fillStyle = ["#2a6db5", "#c2452b", "#1e7f5c", "#d98a0a"][Math.floor(r() * 4)]; g.beginPath(); g.arc(36, y + 24, 14, 0, Math.PI * 2); g.fill();
          g.fillStyle = "#aeb7c1"; g.fillRect(60, y + 16, 110, 8); g.fillRect(60, y + 30, 70, 6);
          g.fillStyle = ["#b39ded", "#7fb4ee", "#ef8578", "#6fcf9f"][Math.floor(r() * 4)]; g.fillRect(24, y + 52, w - 48, 70);
        }
      } else if (kind === "chat") {
        g.fillStyle = "#26506e"; g.fillRect(0, 0, w, 40);
        for (i = 0, y = 58; y < h - 30; i++, y += 46) {
          var mine = r() < 0.45, bw = 90 + r() * (w * 0.4);
          g.fillStyle = mine ? "#5fc5cf" : "#dfe5ec"; g.fillRect(mine ? w - bw - 16 : 16, y, bw, 32);
        }
      } else if (kind === "inbox") {
        g.fillStyle = "#c2452b"; g.fillRect(0, 0, w, 38);
        for (i = 0, y = 48; y < h; i++, y += 38) {
          g.fillStyle = i % 2 ? "#ffffff" : "#edf1f5"; g.fillRect(0, y, w, 36);
          g.fillStyle = i < 3 ? "#172029" : "#8d96a0"; g.fillRect(16, y + 10, 90, 8);
          g.fillStyle = "#aeb7c1"; g.fillRect(124, y + 10, w - 190 - r() * 60, 7); g.fillRect(124, y + 22, w - 260, 5);
        }
      } else {
        var sky = g.createLinearGradient(0, 0, w, h);
        sky.addColorStop(0, "#6a4bb5"); sky.addColorStop(1, "#ef8578");
        g.fillStyle = sky; g.fillRect(0, h * 0.14, w, h * 0.66);
        g.fillStyle = "rgba(255, 255, 255, 0.92)"; g.beginPath(); g.moveTo(w / 2 - 22, h * 0.47 - 30); g.lineTo(w / 2 + 30, h * 0.47); g.lineTo(w / 2 - 22, h * 0.47 + 30); g.closePath(); g.fill();
        g.fillStyle = "#3a4654"; g.fillRect(16, h * 0.86, w - 32, 6);
        g.fillStyle = "#c2452b"; g.fillRect(16, h * 0.86, (w - 32) * 0.37, 6);
      }
    });
  }
  /** An open laptop on a surface: aluminium deck with keys and trackpad, a lid whose screen shows `map`. Its user sits at -z. */
  function laptopProp(map) {
    var g = new THREE.Group(), alu = new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.35, metalness: 0.8 }), keyMap = keyboardTexture();
    var deck = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.022, 0.38), alu);
    deck.position.y = 0.011;
    var keys = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.36), new THREE.MeshStandardMaterial({ map: keyMap, roughness: 0.45, metalness: 0.4 }));
    keys.rotation.x = -Math.PI / 2;
    keys.position.y = 0.023;
    var lid = new THREE.Group();
    lid.position.set(0, 0.022, 0.19);
    lid.rotation.x = 0.3;
    var shell = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.37, 0.016), alu);
    shell.position.y = 0.185;
    var display = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.325), new THREE.MeshBasicMaterial({ map: map }));
    display.rotation.y = Math.PI;
    display.position.set(0, 0.19, -0.009);
    lid.add(shell, display);
    g.add(deck, keys, lid);
    return g;
  }
  /** A flat touch device, lying in the x-y plane with its screen on +z: a dark body with rounded-looking edges, a bright screen
      showing `map`, and a camera bump on the back. `w` and `h` size it: a phone (PHONE) or a tablet (TABLET). */
  function slab(size, map) {
    var g = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], 0.012), new THREE.MeshStandardMaterial({ color: 0x1a1f26, roughness: 0.3, metalness: 0.7 }));
    var screen = new THREE.Mesh(new THREE.PlaneGeometry(size[0] - 0.012, size[1] - 0.016), new THREE.MeshBasicMaterial({ map: map }));
    screen.position.z = 0.0065;
    var lens = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 12), std(0x0c0f13, 0));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(size[0] / 2 - 0.024, size[1] / 2 - 0.026, -0.008);
    g.add(body, screen, lens);
    return g;
  }
  /** A meeting room: pale walls that show only from inside, carpet, a long table down the middle, a chair per seat (SEATS),
      ceiling lights and a big wall screen. Returns the group and the screen's face. */
  function meetingRoom() {
    var g = new THREE.Group(), paint = new THREE.MeshStandardMaterial({ color: 0xcfd6de, roughness: 0.95 }), wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.6 });
    var metal = new THREE.MeshStandardMaterial({ color: 0x2b333d, roughness: 0.4, metalness: 0.7 }), midZ = (MEET_BACK + MEET_FRONT) / 2, depth = MEET_FRONT - MEET_BACK;
    var carpet = new THREE.Mesh(new THREE.PlaneGeometry(MEET_HALF * 2, depth), new THREE.MeshStandardMaterial({ map: carpetTexture(), color: 0xb9c6d6, roughness: 1 }));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, 0.01, midZ);
    g.add(carpet);
    [[0, MEET_BACK, 0, MEET_HALF * 2], [-MEET_HALF, midZ, Math.PI / 2, depth], [MEET_HALF, midZ, -Math.PI / 2, depth], [0, MEET_FRONT, Math.PI, MEET_HALF * 2]].forEach(function (w) {
      var wall = new THREE.Mesh(new THREE.PlaneGeometry(w[3], ROOM_HEIGHT), paint);
      wall.position.set(w[0], ROOM_HEIGHT / 2, w[1]);
      wall.rotation.y = w[2];
      wall.userData.noCast = true;
      g.add(wall);
    });
    var top = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.09, 5.4), wood);
    top.position.set(0, 0.98, 0.6);
    g.add(top);
    [-1.9, 3.1].forEach(function (z) {
      var leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.94, 0.12), metal);
      leg.position.set(0, 0.47, z);
      g.add(leg);
    });
    SEATS.forEach(function (seat) {
      var side = seat[0] > 0 ? 1 : -1;
      var pad = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.09, 0.72), std(0x39414d, 0));
      pad.position.set(seat[0], 0.5, seat[1]);
      var back = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.7), std(0x39414d, 0));
      back.position.set(seat[0] + side * 0.4, 1.08, seat[1]);
      var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.44, 10), metal);
      stem.position.set(seat[0], 0.25, seat[1]);
      g.add(pad, back, stem);
    });
    var bezel = new THREE.Mesh(new THREE.BoxGeometry(5.0, 3.16, 0.1), std(0x14181d, 0));
    bezel.position.set(0, 3.1, MEET_BACK + 0.06);
    var face = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 3.0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    face.position.set(0, 3.1, MEET_BACK + 0.12);
    g.add(bezel, face);
    [-1.2, 2.4].forEach(function (z) {
      var lamp = new THREE.PointLight(0xfff4e2, 30, 0, 2);
      lamp.position.set(0, ROOM_HEIGHT - 0.5, z);
      var panel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.5), new THREE.MeshBasicMaterial({ color: 0xfffbf0 }));
      panel.position.set(0, ROOM_HEIGHT - 0.04, z);
      g.add(lamp, panel);
    });
    return { group: g, face: face };
  }

  builders.ignored = function (sc) {
    var g = new THREE.Group(), room = meetingRoom(), hero = person(BUILDER), listeners = [];
    g.add(room.group);
    hero.group.position.set(3.1, 0, MEET_BACK + 1.0);
    g.add(hero.group);
    // the long page scrolls: its own copy of the texture, one third of it visible at a time
    var pageMap = boringTexture("page").clone();
    pageMap.wrapT = REPEAT_WRAPPING;
    pageMap.repeat.set(1, 1 / 3);
    pageMap.needsUpdate = true;
    var slides = [[0, pageMap], [0.34, boringTexture("slide")], [0.47, boringTexture("flow")], [0.57, boringTexture("sequence")], [0.68, boringTexture("slide")]];
    SEATS.forEach(function (seat, i) {
      var who = person(MEETING_COATS[i], { skin: SKIN_TONES[i % SKIN_TONES.length], hair: HAIR_TONES[(i + 2) % HAIR_TONES.length], trousers: 0x2b2f38 });
      who.group.position.set(seat[0], 0, seat[1]);
      who.group.rotation.y = seat[0] > 0 ? -Math.PI / 2 : Math.PI / 2;
      who.habit = MEETING_HABITS[i];
      var side = seat[0] > 0 ? 1 : -1;
      if (who.habit === "phone") {
        // held in the raised hand, its screen turned to the face
        var phone = slab(PHONE, screenTexture(i ? "chat" : "feed", true));
        phone.position.set(0, -FOREARM - 0.12, 0.05);
        who.elbowR.add(phone);
      } else if (who.habit === "tablet") {
        // propped on the table on a folding cover, leaning back towards its owner
        var tablet = slab(TABLET, screenTexture("video", false)), stand = new THREE.Group();
        tablet.rotation.z = Math.PI / 2;
        tablet.position.y = TABLET[0] / 2;
        var prop = new THREE.Mesh(new THREE.BoxGeometry(TABLET[1], TABLET[0] * 0.8, 0.008), std(0x39414d, 0));
        prop.position.set(0, TABLET[0] * 0.36, -0.07);
        prop.rotation.x = -0.5;
        var lean = new THREE.Group();
        lean.rotation.x = -0.42;
        lean.add(tablet);
        stand.add(lean, prop);
        stand.position.set(seat[0] - side * DEVICE_REACH, 1.03, seat[1]);
        stand.rotation.y = who.group.rotation.y + Math.PI;
        g.add(stand);
      } else {
        var laptop = laptopProp(screenTexture(i % 2 ? "inbox" : "chat", false));
        laptop.position.set(seat[0] - side * DEVICE_REACH, 1.025, seat[1]);
        laptop.rotation.y = who.group.rotation.y;
        g.add(laptop);
      }
      g.add(who.group); listeners.push(who);
    });
    return {
      group: g,
      floor: false,
      day: true,
      accent: 0,
      shots: [
        { at: 0, from: [4.4, 3.7, 5.6], to: [3.6, 3.4, 5.0], look: [0, 2.9, -2] },                              // the room: one presenter, six people elsewhere
        { at: 0.26, from: [-0.9, 3.0, 3.2], to: [0.1, 3.1, 1.6], look: [0.7, 3.8, MEET_BACK] },              // the screen: page, slide, diagram, diagram
        { at: 0.68, from: [-2.7, 3.1, -1.6], to: [-2.7, 3.1, 2.6], look: [1.45, 2.5, -1.0], lookTo: [1.45, 2.5, 2.4] },   // along the faces
        { at: 0.86, from: [1.5, 2.6, -1.4], to: [1.9, 2.6, -1.9], look: [3.1, 2.75, MEET_BACK + 1.0] }          // the presenter notices
      ],
      update: function (u, t) {
        var n = 0;
        while (n + 1 < slides.length && u >= slides[n + 1][0]) n++;
        if (room.face.material.map !== slides[n][1]) { room.face.material.map = slides[n][1]; room.face.material.needsUpdate = true; }
        pageMap.offset.y = 2 / 3 - smooth(span(u, 0.02, 0.34)) * 2 / 3;
        var keen = 1 - smooth(span(u, 0.84, 0.94));
        pose(hero, {
          mood: keen > 0.5 ? "happy" : "sad", nod: lerp(0.55, -0.05, keen), y: Math.abs(Math.sin(t * 4)) * 0.05 * keen,
          lz: -(1.6 + Math.sin(t * 2.6) * 0.25) * keen, lb: -0.25, rx: -0.5 * keen, rb: -1.3 * keen - 0.2
        });
        listeners.forEach(function (who, i) {
          var o = { sit: true, lx: -0.5, lb: -1.1, rx: -0.5, rb: -1.1, mood: "tired", nod: 0.3 };
          if (who.habit === "phone") { o.nod = 0.55; o.rx = -0.55; o.rb = -1.6; o.mood = "calm"; closeHand(who.handR, 0.3); }
          else if (who.habit === "asleep") { o.nod = 0.85 + Math.sin(t * 1.3 + i) * 0.08; }
          else if (who.habit === "yawn") {
            var gape = Math.pow(Math.max(0, Math.sin(t * 1.5 + i)), 3);
            o.nod = 0.2 - 0.6 * gape; o.mood = gape > 0.35 ? "shock" : "tired"; o.lx = lerp(-0.5, -1.4, gape); o.lb = lerp(-1.1, -2.0, gape);
          } else if (who.habit === "tablet") {
            // one finger swipes up the screen, again and again
            var swipe = frac(t * 0.8 + i);
            o.nod = 0.5; o.mood = "calm"; o.lx = -0.75 - 0.12 * Math.sin(swipe * Math.PI); o.lb = -1.2 - 0.25 * swipe;
          } else if (who.habit === "typing") {
            o.nod = 0.4; o.mood = "calm"; o.lx = o.rx = TYPING; o.lb = TYPING_ELBOW + Math.sin(t * 19 + i) * 0.1; o.rb = TYPING_ELBOW + Math.cos(t * 19 + i) * 0.1;
            tapFingers(who.handL, t, 1); tapFingers(who.handR, t, 1);
          }
          pose(who, o);
        });
      }
    };
  };

  /** A name tag that always faces the camera: white text on a dark rounded plate, `size` world units tall. */
  function tag(text, size) {
    var tex = painted("tag-" + text, 512, 128, function (g, w, h) {
      g.font = "700 62px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif";
      var tw = Math.min(w - 40, g.measureText(text).width + 64), x = (w - tw) / 2;
      g.fillStyle = "rgba(11, 16, 23, 0.88)";
      g.beginPath(); g.moveTo(x + 40, 14); g.arcTo(x + tw, 14, x + tw, h - 14, 40); g.arcTo(x + tw, h - 14, x, h - 14, 40); g.arcTo(x, h - 14, x, 14, 40); g.arcTo(x, 14, x + tw, 14, 40); g.closePath(); g.fill();
      g.fillStyle = "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(text, w / 2, h / 2 + 3, w - 60);
    });
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(size * 4, size, 1);
    return sp;
  }
  /** Studio screens and boards: "timeline" (an editor's tracks and playhead), "keyframes" (an animator's character and keys),
      "callsheet" (the crew's day: every craft and its call time) and "myproject" (the builder's own, much smaller, reality). */
  function studioTexture(kind) {
    return painted("studio-" + kind, 512, kind === "callsheet" || kind === "myproject" ? 640 : 320, function (g, w, h) {
      var r = rng(kind.length * 5), i, x;
      if (kind === "callsheet" || kind === "myproject") {
        var mine = kind === "myproject", rows = mine ? MY_PROJECT : CREW.map(function (c, n) { return [c.role, (7 + n % 3) + ":00"]; });
        g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#172029"; g.font = "700 54px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif"; g.textBaseline = "middle";
        g.fillText(mine ? tx("mineTitle", "MY PROJECT") : tx("callTitle", "CALL SHEET"), 32, 52);
        g.font = "600 " + (mine ? 40 : 30) + "px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif";
        var step = mine ? 96 : 52;
        rows.forEach(function (row, n) {
          g.fillStyle = n % 2 ? "#ffffff" : "#edf1f5"; g.fillRect(20, 96 + n * step, w - 40, step - 2);
          g.fillStyle = "#172029"; g.textAlign = "left"; g.fillText(row[0], 36, 96 + n * step + step / 2);
          g.fillStyle = "#26506e"; g.textAlign = "right"; g.fillText(row[1], w - 36, 96 + n * step + step / 2);
        });
        g.fillStyle = "#0e7c86"; g.fillRect(20, h - 108, w - 40, 84);
        g.fillStyle = "#ffffff"; g.font = "700 " + (mine ? 34 : 38) + "px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif";
        g.textAlign = "center"; g.fillText(mine ? tx("mineFoot", "Still deserves to be seen") : tx("callFoot", "One crew. One vision."), w / 2, h - 66);
        return;
      }
      g.fillStyle = "#12171d"; g.fillRect(0, 0, w, h);
      if (kind === "timeline") {
        g.fillStyle = "#2a323c"; g.fillRect(16, 14, w - 32, 120);
        g.fillStyle = "#5fc5cf"; g.beginPath(); g.moveTo(w / 2 - 18, 50); g.lineTo(w / 2 + 24, 74); g.lineTo(w / 2 - 18, 98); g.closePath(); g.fill();
        for (i = 0; i < 4; i++) {
          x = 16;
          while (x < w - 40) {
            var len = 30 + r() * 90;
            g.fillStyle = ["#6a4bb5", "#2a6db5", "#1e7f5c", "#d98a0a"][i];
            g.fillRect(x, 150 + i * 40, Math.min(len, w - 16 - x), 30);
            x += len + 6;
          }
        }
        g.fillStyle = "#ef8578"; g.fillRect(w * 0.42, 144, 4, 170);
      } else {
        g.fillStyle = "#f2c14e"; g.beginPath(); g.arc(150, 96, 40, 0, Math.PI * 2); g.fill();
        g.fillRect(118, 140, 64, 96);
        g.strokeStyle = "#5fc5cf"; g.lineWidth = 3; g.setLineDash([8, 6]); g.beginPath(); g.moveTo(150, 96); g.bezierCurveTo(260, 20, 360, 160, 470, 70); g.stroke(); g.setLineDash([]);
        g.fillStyle = "#2a323c"; g.fillRect(16, 262, w - 32, 44);
        for (i = 0; i < 9; i++) { g.fillStyle = "#ef8578"; g.save(); g.translate(46 + i * 52, 284); g.rotate(Math.PI / 4); g.fillRect(-8, -8, 16, 16); g.restore(); }
      }
    });
  }
  /** A film camera on a tripod, about head height, its lens towards +z. */
  function filmCamera() {
    var g = new THREE.Group(), black = new THREE.MeshStandardMaterial({ color: 0x1a222c, roughness: 0.45, metalness: 0.6 });
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.74), std(0x39414d, 0.05));
    body.position.y = 1.62;
    var barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.4, 24), black);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 1.62, 0.55);
    var glass = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.35), new THREE.MeshStandardMaterial({ color: 0x1b3a66, emissive: 0x2a6db5, emissiveIntensity: 0.5, roughness: 0.08, metalness: 0.9 }));
    glass.rotation.x = Math.PI / 2;
    glass.position.set(0, 1.62, 0.66);
    var hood = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.34, 0.16), black);
    hood.position.set(0, 1.62, 0.8);
    var mags = [0.18, -0.2].map(function (z) {
      var reel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 24), black);
      reel.rotation.z = Math.PI / 2;
      reel.position.set(0, 1.98, z);
      return reel;
    });
    var rec = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), std(0xff3b30, 2.5));
    rec.position.set(0.2, 1.84, 0.36);
    g.add(body, barrel, glass, hood, mags[0], mags[1], rec);
    [0, 2.1, 4.2].forEach(function (ang) { g.add(rod([0, 1.42, 0], [Math.sin(ang) * 0.55, 0, Math.cos(ang) * 0.55], 0.03, black)); });
    return g;
  }
  /** A studio light: a tall stand carrying a softbox whose face glows, turned towards `aimX` on the floor line. */
  function softbox(colour) {
    var g = new THREE.Group(), black = std(0x1a222c, 0);
    g.add(rod([0, 0, 0], [0, 2.7, 0], 0.03, black));
    [0, 2.1, 4.2].forEach(function (ang) { g.add(rod([0, 0.5, 0], [Math.sin(ang) * 0.5, 0, Math.cos(ang) * 0.5], 0.02, black)); });
    var box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.3), black);
    box.position.set(0, 2.9, 0.1);
    var face = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.72), new THREE.MeshBasicMaterial({ color: colour }));
    face.position.set(0, 2.9, 0.26);
    var bloom = glowSprite(colour, 3.2, 0.5);
    bloom.position.set(0, 2.9, 0.4);
    g.add(box, face, bloom);
    return g;
  }
  /** A small work desk with a stool behind it; the worker sits at the origin facing +z and the desk stands in front. */
  function workDesk() {
    var g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7 }), metal = std(0x2b333d, 0);
    var top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.8), wood);
    top.position.set(0, 0.98, 0.78);
    g.add(top);
    [[-0.88, 0.45], [0.88, 0.45], [-0.88, 1.1], [0.88, 1.1]].forEach(function (at) { g.add(rod([at[0], 0, at[1]], [at[0], 0.95, at[1]], 0.03, metal)); });
    var stool = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 20), std(0x39414d, 0));
    stool.position.y = 0.52;
    g.add(stool, rod([0, 0, 0], [0, 0.5, 0], 0.04, metal));
    return g;
  }
  /** A desk monitor on a foot, its screen (showing `map`) towards +z. */
  function monitor(map) {
    var g = new THREE.Group(), black = std(0x14181d, 0);
    var bezel = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.5, 0.04), black);
    bezel.position.y = 0.42;
    var face = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.44), new THREE.MeshBasicMaterial({ map: map }));
    face.position.set(0, 0.42, 0.022);
    var foot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.02, 18), black);
    g.add(bezel, face, foot, rod([0, 0, 0], [0, 0.2, 0], 0.02, black));
    return g;
  }

  builders.wall = function (sc) {
    var g = new THREE.Group(), hero = person(BUILDER), crew = {}, tags = [];
    // the stage: a floor, a long back wall and a painted strip of light along it
    var stage = new THREE.Mesh(new THREE.PlaneGeometry(70, 30), new THREE.MeshStandardMaterial({ color: 0x565f6b, roughness: 0.85 }));
    stage.rotation.x = -Math.PI / 2;
    var backdrop = new THREE.Mesh(new THREE.PlaneGeometry(70, 16), new THREE.MeshStandardMaterial({ color: 0x8793a1, roughness: 0.95 }));
    backdrop.position.set(0, 8, -4.5);
    backdrop.userData.noCast = true;
    g.add(stage, backdrop);
    CREW.forEach(function (c, i) {
      var x = CREW_START + i * CREW_GAP, bay = new THREE.Group(), who = person(c.top, { skin: SKIN_TONES[i % SKIN_TONES.length], hair: HAIR_TONES[(i + 1) % HAIR_TONES.length], trousers: 0x2b2f38 });
      bay.position.x = x;
      bay.add(who.group);
      var name = tag(tx("crew" + i, c.role), 0.5);
      name.position.set(0, 3.15, 0.2);
      bay.add(name);
      tags.push({ sprite: name, x: x });
      var lamp = new THREE.PointLight(0xfff1dc, 9, 0, 2);
      lamp.position.set(x, 3.6, 2.2);
      g.add(lamp);
      crew[c.id] = { who: who, bay: bay };
      g.add(bay);
    });
    // what each of them works with
    var paper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.4), std(0xf4f6f8, 0.05));
    paper.position.set(-0.6, 1.06, 0.8);
    var writerLaptop = laptopProp(boringTexture("slide"));
    writerLaptop.position.set(0.1, 1.01, 0.78);
    crew.writer.bay.add(workDesk(), writerLaptop, paper);
    var chair = new THREE.Group(), canvas = std(0x1a222c, 0), frame = std(0xc9a25a, 0.1);
    var sling = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.6), canvas);
    sling.position.y = 0.56;
    var rest = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.04), canvas);
    rest.position.set(0, 1.15, -0.32);
    chair.add(sling, rest);
    [[-0.36, 0.28], [0.36, 0.28], [-0.36, -0.28], [0.36, -0.28]].forEach(function (at) { chair.add(rod([at[0], 0, -at[1]], [at[0], at[1] < 0 ? 1.3 : 0.6, at[1]], 0.025, frame)); });
    var megaphone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xc2452b, roughness: 0.4, side: THREE.DoubleSide }));
    megaphone.rotation.x = Math.PI;
    megaphone.position.set(0, -FOREARM - 0.28, 0.02);
    crew.director.who.elbowL.add(megaphone);
    crew.director.bay.add(chair);
    var rig = filmCamera();
    rig.position.set(0.1, 0, 0.75);
    crew.camera.bay.add(rig);
    var boom = new THREE.Group(), fluff = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.3, 6, 14), new THREE.MeshStandardMaterial({ color: 0x5b6673, roughness: 1 }));
    fluff.rotation.z = Math.PI / 2;
    fluff.position.set(-1.9, 0, 0);
    boom.add(rod([0.5, 0, 0], [-1.75, 0, 0], 0.018, std(0x14181d, 0)), fluff);
    boom.position.set(0, 2.36, 0.02);
    boom.rotation.z = -0.12;
    var cans = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 8, 20, Math.PI), std(0x14181d, 0));
    cans.position.y = HEAD + 0.06;
    crew.sound.who.head.add(cans);
    [-1, 1].forEach(function (s) {
      var cup = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 14), std(0x14181d, 0));
      cup.rotation.z = Math.PI / 2;
      cup.position.set(s * 0.27, HEAD + 0.04, 0);
      crew.sound.who.head.add(cup);
    });
    crew.sound.bay.add(boom);
    var key = softbox(0xfff1c4), fill = softbox(0xcfe3ff);
    key.position.set(-0.9, 0, -0.2);
    key.rotation.y = 0.5;
    fill.position.set(1.0, 0, -0.8);
    fill.rotation.y = -0.4;
    fill.scale.setScalar(0.85);
    crew.lighting.bay.add(key, fill);
    var cutA = monitor(studioTexture("timeline")), cutB = monitor(studioTexture("timeline"));
    cutA.position.set(-0.52, 1.02, 0.92);
    cutA.rotation.y = Math.PI - 0.3;
    cutB.position.set(0.52, 1.02, 0.92);
    cutB.rotation.y = Math.PI + 0.3;
    crew.editor.bay.add(workDesk(), cutA, cutB);
    var draw = monitor(studioTexture("keyframes")), pad = slab(TABLET, studioTexture("keyframes"));
    draw.position.set(-0.5, 1.02, 0.94);
    draw.rotation.y = Math.PI - 0.3;
    pad.rotation.set(-Math.PI / 2 + 0.25, 0, 0);
    pad.position.set(0.35, 1.05, 0.72);
    crew.animator.bay.add(workDesk(), draw, pad);
    // the three who work at screens sit turned away from the camera, so we look over their shoulders at what they are making
    [crew.writer, crew.editor, crew.animator].forEach(function (c) { c.bay.rotation.y = DESK_TURN; });
    var board = slab([0.24, 0.32], studioTexture("callsheet"));
    board.position.set(0, -FOREARM - 0.14, 0.06);
    crew.producer.who.elbowL.add(board);
    var call = slab(PHONE, screenTexture("chat", true));
    call.position.set(0, -FOREARM - 0.1, 0.04);
    crew.producer.who.elbowR.add(call);
    // the builder, who admires all this, and the board that says what their own project has to work with
    var billX = CREW_START + CREW.length * CREW_GAP + 1.2;
    var easel = new THREE.Mesh(new THREE.BoxGeometry(2.7, 3.3, 0.1), std(0x14181d, 0));
    easel.position.set(billX + 1.3, 2.3, -1.6);
    var bill = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 3.1), new THREE.MeshBasicMaterial({ map: studioTexture("myproject") }));
    bill.position.set(billX + 1.3, 2.3, -1.54);
    hero.group.position.set(billX - 0.9, 0, 0.4);
    var heroLamp = new THREE.PointLight(0xfff1dc, 10, 0, 2);
    heroLamp.position.set(billX, 3.4, 2.4);
    g.add(easel, bill, hero.group, heroLamp, rod([billX + 1.3, 0, -1.7], [billX + 1.3, 0.7, -1.7], 0.05, std(0x14181d, 0)));
    var first = CREW_START, last = CREW_START + (CREW.length - 1) * CREW_GAP;
    return {
      group: g,
      floor: false,
      day: true,
      accent: 0,
      shots: [
        { at: 0, from: [first - 5, 7.5, 15], to: [first + 1, 5, 12.5], look: [first + 7, 2.6, 0] },                               // the whole stage, from the crane
        { at: CREW_TRACK[0], from: [first, 2.7, 6.6], to: [last, 2.7, 6.6], look: [first, 2.75, 0], lookTo: [last, 2.75, 0] },    // past every job, one by one
        { at: CREW_TRACK[1], from: [billX + 0.6, 2.8, 6.2], to: [billX + 0.3, 2.7, 5.2], look: [billX + 0.2, 2.9, -0.6] }         // the builder's own project
      ],
      update: function (u, t) {
        var camX = lerp(first, last, span(u, CREW_TRACK[0], CREW_TRACK[1]));
        tags.forEach(function (tg) {
          var near = 1 - smooth(span(Math.abs(camX - tg.x), 0.4, 2.2));
          tg.sprite.scale.set(0.5 * 4 * (1 + 0.3 * near), 0.5 * (1 + 0.3 * near), 1);
        });
        pose(crew.writer.who, { sit: true, mood: "happy", nod: 0.3, lx: TYPING, rx: TYPING, lb: TYPING_ELBOW + Math.sin(t * 19) * 0.1, rb: TYPING_ELBOW + Math.cos(t * 19) * 0.1 });
        tapFingers(crew.writer.who.handL, t, 1); tapFingers(crew.writer.who.handR, t, 1);
        pose(crew.director.who, { sit: true, mood: "happy", nod: -0.1, lx: -1.5, lb: -1.9 + Math.sin(t * 5) * 0.08, rx: -1.3, rz: 0.5, rb: -0.2 + Math.sin(t * 3) * 0.15 });
        pose(crew.camera.who, { mood: "happy", nod: 0.25, lx: -1.0, lb: -0.9, rx: -1.0, rb: -0.9, lk: 0.2, rk: 0.2, y: -0.03 });
        rig.rotation.y = Math.sin(t * 0.8) * 0.3;
        pose(crew.sound.who, { mood: "happy", nod: -0.2, lz: -2.9, lb: -0.25, rz: 2.9, rb: -0.25, y: Math.sin(t * 2) * 0.02 });
        boom.rotation.z = -0.12 + Math.sin(t * 1.4) * 0.05;
        pose(crew.lighting.who, { mood: "happy", nod: -0.45, lz: -2.5 - Math.sin(t * 2.4) * 0.15, lb: -0.4, rx: -0.3, rb: -0.5 });
        pose(crew.editor.who, { sit: true, mood: "happy", nod: 0.2, lx: TYPING, lb: TYPING_ELBOW, rx: TYPING + Math.sin(t * 3) * 0.06, rz: 0.25 + Math.sin(t * 2.2) * 0.12, rb: TYPING_ELBOW });
        pose(crew.animator.who, { sit: true, mood: "happy", nod: 0.4, lx: TYPING + Math.sin(t * 6) * 0.08, lz: -0.2 + Math.cos(t * 6) * 0.1, lb: TYPING_ELBOW, rx: TYPING, rb: TYPING_ELBOW });
        var walk = stride(t * 5);
        pose(crew.producer.who, { mood: "happy", nod: 0.1, lx: -0.5, lb: -1.5, rx: -1.3, rb: -2.2, rz: 0.2, ll: walk.ll * 0.4, rl: walk.rl * 0.4, lk: walk.lk * 0.4, rk: walk.rk * 0.4 });
        crew.producer.who.group.position.x = Math.sin(t * 1.2) * 0.35;
        // the builder applauds the crew, then turns to their own board with a small shrug: wonderful, and out of reach
        var wish = smooth(span(u, CREW_TRACK[1] + 0.1, CREW_TRACK[1] + 0.18)), clap = Math.abs(Math.sin(t * 9)) * (1 - wish);
        pose(hero, {
          mood: wish > 0.5 ? "calm" : "happy", nod: 0.15 * wish, y: 0.03 * clap,
          lx: lerp(-1.25, -0.2, wish), lz: lerp(0.5 - 0.25 * clap, -0.55, wish), lb: lerp(-1.5, -1.5, wish),
          rx: lerp(-1.25, -0.2, wish), rz: lerp(-0.5 + 0.25 * clap, 0.55, wish), rb: lerp(-1.5, -1.5, wish)
        });
      }
    };
  };

  /** A frame of the finished film, for a screen inside the story: 0 the title card, 1 a night skyline, 2 a sunrise with a figure. */
  function filmFrame(n) {
    return painted("frame-" + n, 640, 360, function (g, w, h) {
      var r = rng(60 + n), grad = g.createLinearGradient(0, 0, 0, h), x;
      if (n === 0) {
        g.fillStyle = "#0b1017"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#f2c14e"; g.beginPath(); g.moveTo(w / 2 - 34, 86); g.lineTo(w / 2 + 46, 132); g.lineTo(w / 2 - 34, 178); g.closePath(); g.fill();
        g.fillStyle = "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle";
        g.font = "700 46px 'Fraunces', 'Source Sans 3', serif"; g.fillText(tx("frameTitle", "MY PROJECT"), w / 2, 236);
        g.fillStyle = "#5fc5cf"; g.font = "600 24px 'Source Sans 3', system-ui, sans-serif"; g.fillText(tx("frameSub", "THE TRAILER"), w / 2, 282);
      } else if (n === 1) {
        grad.addColorStop(0, "#07102a"); grad.addColorStop(1, "#2a3f73");
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        for (x = 0; x < w; x += 46) {
          var bh = 90 + r() * 170;
          g.fillStyle = "#0e1622"; g.fillRect(x, h - bh, 42, bh);
          for (var y = h - bh + 12; y < h - 10; y += 18) for (var wx = x + 6; wx < x + 34; wx += 12) if (r() < 0.45) { g.fillStyle = "#ffd98a"; g.fillRect(wx, y, 6, 9); }
        }
      } else {
        grad.addColorStop(0, "#2a6db5"); grad.addColorStop(0.6, "#ef8578"); grad.addColorStop(1, "#f2c14e");
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        g.fillStyle = "#fff1c4"; g.beginPath(); g.arc(w * 0.68, h * 0.62, 70, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#172029"; g.fillRect(0, h * 0.8, w, h * 0.2);
        g.beginPath(); g.arc(w * 0.3, h * 0.5, 30, 0, Math.PI * 2); g.fill(); g.fillRect(w * 0.3 - 26, h * 0.56, 52, 90);
      }
      g.fillStyle = "#000000"; g.fillRect(0, 0, w, 22); g.fillRect(0, h - 22, w, 22);
    });
  }
  /** A piano keyboard seen from above. */
  function pianoTexture() {
    return painted("piano", 512, 128, function (g, w, h) {
      g.fillStyle = "#f4f6f8"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#8d96a0"; g.lineWidth = 2;
      for (var k = 0; k <= 21; k++) { g.beginPath(); g.moveTo(k * w / 21, 0); g.lineTo(k * w / 21, h); g.stroke(); }
      g.fillStyle = "#14181d";
      for (k = 0; k < 21; k++) if ([0, 1, 3, 4, 5].indexOf(k % 7) >= 0) g.fillRect((k + 1) * w / 21 - 8, 0, 16, h * 0.6);
    });
  }

  /** The builder's office set up as a workshop: the desk set, and a bench along the back wall carrying the four tools (the AI
      assistant, the 3D engine, the AI voice and the keyboard). Returns the group, the desk set, the assistant's screen and
      drive(levels, t), which lights and animates each tool by its level 0..1. Used by the scenes that happen here. */
  function workshop(colour) {
    var g = new THREE.Group(), set = deskSet(colour), units = [];
    g.add(officeRoom(), set.group);
    // a workbench along the back wall carrying the four tools
    var wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7 }), dark = new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.4, metalness: 0.6 });
    var bench = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.09, 0.9), wood);
    bench.position.set(0.5, BENCH_TOP - 0.045, BENCH_Z);
    g.add(bench);
    [-3.9, 0.5, 4.9].forEach(function (x) { g.add(rod([x, 0, BENCH_Z], [x, BENCH_TOP - 0.09, BENCH_Z], 0.05, dark)); });
    TOOLS.forEach(function (tool, i) {
      var unit = new THREE.Group(), name = tag(tx("tool" + i, tool.name), 0.36), lamp = new THREE.PointLight(hex(tool.colour), 0, 0, 2);
      unit.position.set(TOOL_X[i], BENCH_TOP, BENCH_Z);
      name.position.set(0, 1.45, 0.2);
      lamp.position.set(0, 0.8, 0.9);
      var led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), std(hex(tool.colour), 0));
      led.position.set(0.5, 0.08, 0.36);
      unit.add(name, lamp, led);
      units.push({ group: unit, lamp: lamp, led: led, at: TOOL_AT[i] });
      g.add(unit);
    });
    // 1 the assistant: a box with a screen where the script appears
    var brain = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.82, 0.6), dark);
    brain.position.y = 0.41;
    var brainScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.72), new THREE.MeshBasicMaterial({ map: scriptTexture(), transparent: true, opacity: 0 }));
    brainScreen.position.set(-0.22, 0.42, 0.305);
    units[0].group.add(brain, brainScreen);
    // 2 the 3D engine: a little stage under a glass dome, with a figure that comes alive
    var plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.56, 0.14, 32), dark);
    plinth.position.y = 0.07;
    var dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.4, side: THREE.DoubleSide, depthWrite: false }));
    dome.position.y = 0.14;
    var mini = person(BUILDER);
    mini.group.scale.setScalar(0.2);
    var turntable = new THREE.Group();
    turntable.position.y = 0.14;
    turntable.add(mini.group);
    units[1].group.add(plinth, dome, turntable);
    // 3 the voice: a studio microphone and a speaker, with a line of level bars between them
    var speaker = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.7, 0.4), dark);
    speaker.position.set(0.36, 0.35, 0);
    [0.48, 0.2].forEach(function (y, n) {
      var cone = new THREE.Mesh(new THREE.CylinderGeometry(n ? 0.09 : 0.15, n ? 0.09 : 0.15, 0.02, 24), std(0x39414d, 0));
      cone.rotation.x = Math.PI / 2;
      cone.position.set(0.36, y, 0.205);
      units[2].group.add(cone);
    });
    var micHead = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.16, 6, 16), new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.3, metalness: 0.9 }));
    micHead.position.set(-0.36, 0.62, 0.1);
    var levels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 1, 0.03), std(hex(TOOLS[2].colour), 0.9), 9);
    units[2].group.add(speaker, micHead, rod([-0.36, 0, 0.1], [-0.36, 0.5, 0.1], 0.02, dark), levels);
    // 4 the music: a small keyboard, and notes that rise from it
    var synth = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 0.5), dark);
    synth.position.y = 0.07;
    var keys = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshStandardMaterial({ map: pianoTexture(), roughness: 0.4 }));
    keys.rotation.x = -Math.PI / 2;
    keys.position.set(0, 0.143, 0.07);
    var notes = [0, 1, 2, 3, 4].map(function (n) {
      var note = glowSprite(hex(TOOLS[3].colour), 0.3, 0);
      units[3].group.add(note);
      return note;
    });
    units[3].group.add(synth, keys);
    /** Light and move the tools: `levelsOn` is one number per tool, 0 asleep to 1 fully working. */
    function drive(levelsOn, t) {
      units.forEach(function (unit, n) {
        var on = levelsOn[n];
        unit.lamp.intensity = 7 * on;
        unit.led.material.emissiveIntensity = 3 * on;
        unit.on = on;
      });
      brainScreen.material.opacity = units[0].on;
      turntable.rotation.y = t * 1.4 * units[1].on;
      mini.group.visible = units[1].on > 0.02;
      mini.group.scale.setScalar(0.2 * Math.max(0.05, units[1].on));
      cheer(mini, units[1].on, t);
      for (var i = 0; i < 9; i++) {
        var level = 0.03 + units[2].on * 0.5 * Math.abs(Math.sin(t * 7 + i * 0.8));
        dummy.position.set(-0.2 + i * 0.045, 0.2 + level / 2, 0.22);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, level, 1);
        dummy.updateMatrix();
        levels.setMatrixAt(i, dummy.matrix);
      }
      levels.instanceMatrix.needsUpdate = true;
      notes.forEach(function (note, k) {
        var rise = frac(t * 0.6 + k / 5);
        note.position.set(-0.45 + k * 0.22, 0.25 + rise * 1.0, 0.1);
        note.material.opacity = units[3].on * (1 - rise);
      });
    }
    // the big screen on the wall above the bench: dark until a scene gives it something to show
    var bezel = new THREE.Mesh(new THREE.BoxGeometry(5.2, 3.0, 0.1), std(0x14181d, 0));
    bezel.position.set(0.5, 3.75, WALL_Z + 0.06);
    var wall = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 2.8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
    wall.position.set(0.5, 3.75, WALL_Z + 0.12);
    g.add(bezel, wall);
    return { group: g, set: set, screen: brainScreen, wall: wall, drive: drive };
  }

  builders.spark = function (sc) {
    var shop = workshop(hex(sc.colour)), g = shop.group, set = shop.set, hero = set.builder;
    // the prompt on the laptop: typed letter by letter, sent, then "working"
    var promptCanvas = document.createElement("canvas"), pen = promptCanvas.getContext("2d"), shown = "";
    promptCanvas.width = 512; promptCanvas.height = 320;
    var promptMap = new THREE.CanvasTexture(promptCanvas);
    promptMap.colorSpace = THREE.SRGBColorSpace;
    set.display.material.map = promptMap;
    /** Redraw the laptop screen: the prompt box with `letters` of the prompt typed, and its state ("typing", "sent"). */
    function drawPrompt(letters, state) {
      var key = letters + state;
      if (key === shown) return;
      shown = key;
      pen.fillStyle = "#0f1722"; pen.fillRect(0, 0, 512, 320);
      pen.fillStyle = "#5fc5cf"; pen.font = "700 30px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif"; pen.textBaseline = "middle"; pen.textAlign = "left";
      pen.fillText(tx("promptHead", "1 PROMPT"), 28, 44);
      pen.fillStyle = "#1b2a3b"; pen.fillRect(24, 78, 464, 130);
      pen.strokeStyle = state === "sent" ? "#39c27d" : "#5fc5cf"; pen.lineWidth = 4; pen.strokeRect(24, 78, 464, 130);
      pen.fillStyle = "#ffffff"; pen.font = "600 32px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif";
      var text = PROMPT_TEXT.slice(0, letters), cut = text.lastIndexOf(" ", 22);
      pen.fillText(text.length > 24 ? text.slice(0, cut) : text, 42, 122);
      if (text.length > 24) pen.fillText(text.slice(cut + 1), 42, 166);
      pen.fillStyle = state === "sent" ? "#39c27d" : "#3a4654"; pen.fillRect(336, 232, 152, 52);
      pen.fillStyle = "#ffffff"; pen.textAlign = "center"; pen.fillText(state === "sent" ? tx("promptSent", "Working") : tx("promptSend", "Send"), 412, 259);
      promptMap.needsUpdate = true;
    }
    // the cable from the laptop, round the room, along the bench and up to the screen; a spark of light runs down it
    for (var c = 0; c + 1 < CABLE.length; c++) g.add(rod(CABLE[c].slice(0, 3), CABLE[c + 1].slice(0, 3), 0.018, std(0x14181d, 0)));
    var spark = glowSprite(hex(sc.colour), 0.9, 0), sparkLight = new THREE.PointLight(hex(sc.colour), 0, 0, 2);
    g.add(spark, sparkLight);
    // the screen where the film arrives
    var frames = [filmFrame(0), filmFrame(1), filmFrame(2)];
    var film = shop.wall;
    film.material.map = frames[0];
    var wash = new THREE.PointLight(hex(sc.colour), 0, 0, 2);
    wash.position.set(0.5, 3.6, 0.4);
    g.add(wash);
    return {
      group: g,
      floor: false,
      accent: 0,
      shots: [
        { at: 0, from: [1.45, 3.0, -0.7], to: [1.15, 2.8, -0.45], look: [-0.05, 2.1, 1.2] },                                        // one prompt, typed and sent
        { at: TOOL_TRACK[0], from: [-4.0, 3.5, 2.7], to: [5.0, 3.5, 2.7], look: [-3.6, 2.5, BENCH_Z], lookTo: [4.6, 2.5, BENCH_Z] },   // along the bench as each tool wakes
        { at: TOOL_TRACK[1], from: [3.2, 2.7, 4.6], to: [2.2, 2.5, 3.4], look: [0.3, 3.6, WALL_Z] }                                 // the film plays
      ],
      update: function (u, t) {
        var typed = Math.floor(span(u, 0.05, 0.19) * PROMPT_TEXT.length), sent = u >= PROMPT_SENT;
        drawPrompt(typed, sent ? "sent" : "typing");
        // the spark's place: between the two waypoints whose times bracket now
        var n = 0;
        while (n + 2 < CABLE.length && u >= CABLE[n + 1][3]) n++;
        spark.position.copy(v3(CABLE[n]).lerp(v3(CABLE[n + 1]), span(u, CABLE[n][3], CABLE[n + 1][3])));
        var running = sent && u < CABLE[CABLE.length - 1][3] + 0.02;
        spark.material.opacity = running ? 0.95 : 0;
        spark.scale.setScalar(0.8 + 0.25 * Math.sin(t * 20));
        sparkLight.position.copy(spark.position);
        sparkLight.intensity = running ? 5 : 0;
        shop.drive(TOOL_AT.map(function (at) { return smooth(span(u, at, at + 0.03)); }), t);
        var playing = smooth(span(u, TOOL_TRACK[1] - 0.01, TOOL_TRACK[1] + 0.04)), frame = frames[Math.floor(t * 0.7) % frames.length];
        if (film.material.map !== frame) { film.material.map = frame; film.material.needsUpdate = true; }
        film.material.opacity = playing;
        wash.intensity = 16 * playing * (0.8 + 0.2 * Math.sin(t * 5));
        // the builder: types, sends, swivels round to watch the bench, and throws both arms up when the film starts
        var press = Math.sin(Math.PI * span(u, PROMPT_SENT - 0.03, PROMPT_SENT + 0.015)), turned = smooth(span(u, PROMPT_SENT + 0.02, PROMPT_SENT + 0.08)), typing = 1 - smooth(span(u, 0.19, 0.2));
        set.swivel.rotation.y = Math.PI * turned;
        pose(hero, {
          sit: true, mood: playing > 0.3 ? "happy" : turned > 0.5 ? "calm" : "tired", nod: lerp(0.2, -0.15, turned) - 0.2 * playing,
          lx: lerp(TYPING, -0.1, turned), lz: -ARMS_UP * 0.92 * playing, lb: lerp(TYPING_ELBOW - 0.45 * press, -0.45, turned),
          rx: lerp(TYPING, -0.1, turned), rz: ARMS_UP * 0.92 * playing, rb: lerp(TYPING_ELBOW, -0.45, turned)
        });
        tapFingers(hero.handL, t, typing);
        tapFingers(hero.handR, t, typing);
        set.light.intensity = SCREEN_GLOW;
      }
    };
  };

  /* --- act two: how it works, step by step --- */

  /** A document icon for one file type: a page with a folded corner, a few lines and the extension on a coloured band. */
  function fileTexture(ext, colour) {
    return painted("file-" + ext, 260, 340, function (g, w, h) {
      var fold = 62;
      g.fillStyle = "#f6f8fa";
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w - fold, 0); g.lineTo(w, fold); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill();
      g.fillStyle = "#c9d2dc";
      g.beginPath(); g.moveTo(w - fold, 0); g.lineTo(w - fold, fold); g.lineTo(w, fold); g.closePath(); g.fill();
      g.fillStyle = "#b4bfcb";
      for (var i = 0; i < 5; i++) g.fillRect(26, 84 + i * 26, i === 4 ? 110 : 200, 10);
      g.fillStyle = colour;
      g.fillRect(0, h - 110, w, 110);
      g.fillStyle = "#ffffff";
      g.font = "700 62px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(ext, w / 2, h - 53);
    });
  }
  /** The finished script: a dark page headed SCRIPT with one coloured line per scene. */
  function scriptTexture() {
    return painted("script", 440, 600, function (g, w, h) {
      g.fillStyle = "#101a26";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#f2c14e";
      g.font = "700 54px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif";
      g.fillText(tx("scriptWord", "SCRIPT"), 36, 78);
      scenes.forEach(function (s, i) {
        var y = 124 + i * 38;
        g.fillStyle = s.colour;
        g.beginPath(); g.arc(50, y, 11, 0, Math.PI * 2); g.fill();
        g.fillStyle = "rgba(230, 235, 241, 0.75)";
        g.fillRect(78, y - 6, 150 + (i * 53) % 170, 12);
      });
    });
  }
  /** The road: asphalt with a dashed centre line and kerbs. */
  function roadTexture() {
    return painted("road", 128, 1024, function (g, w, h) {
      g.fillStyle = "#11161c";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#3a4450";
      g.fillRect(0, 0, 8, h); g.fillRect(w - 8, 0, 8, h);
      g.fillStyle = "#e8d48a";
      for (var y = 0; y < h; y += 64) g.fillRect(w / 2 - 3, y, 6, 34);
    });
  }
  /** A small car heading +z, with lit head and tail lights. */
  function car(colour) {
    var g = new THREE.Group(), paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.3, metalness: 0.6 }), tyre = std(0x0c0f13, 0);
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 1.9), paint);
    body.position.y = 0.36;
    var cabin = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.28, 1.0), new THREE.MeshStandardMaterial({ color: 0x16202b, roughness: 0.1, metalness: 0.8 }));
    cabin.position.set(0, 0.64, -0.1);
    g.add(body, cabin);
    [[-0.45, 0.6], [0.45, 0.6], [-0.45, -0.6], [0.45, -0.6]].forEach(function (at) {
      var wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 14), tyre);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(at[0], 0.17, at[1]);
      g.add(wheel);
    });
    [-0.3, 0.3].forEach(function (x) {
      var beam = glowSprite(0xfff1c4, 0.9, 0.95);
      beam.position.set(x, 0.38, 1.0);
      var tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.04), std(0xff3b30, 2));
      tail.position.set(x, 0.4, -0.96);
      g.add(beam, tail);
    });
    return g;
  }

  builders.script = function (sc) {
    var shop = workshop(hex(sc.colour)), g = shop.group, set = shop.set, hero = set.builder, cards = [];
    // the laptop: a folder of project files, selected one by one, then attached
    var folder = document.createElement("canvas"), pen = folder.getContext("2d"), folderShown = "";
    folder.width = 512; folder.height = 320;
    var folderMap = new THREE.CanvasTexture(folder);
    folderMap.colorSpace = THREE.SRGBColorSpace;
    set.display.material.map = folderMap;
    /** Redraw the folder window with the first `picked` files highlighted; `sent` turns the button green. */
    function drawFolder(picked, sent) {
      var key = picked + "/" + sent;
      if (key === folderShown) return;
      folderShown = key;
      pen.fillStyle = "#f4f6f8"; pen.fillRect(0, 0, 512, 320);
      pen.fillStyle = "#26506e"; pen.fillRect(0, 0, 512, 44);
      pen.fillStyle = "#ffffff"; pen.font = "700 26px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif"; pen.textBaseline = "middle"; pen.textAlign = "left";
      pen.fillText(tx("folderName", "My project"), 20, 23);
      PROJECT_FILES.forEach(function (file, n) {
        var y = 52 + n * 36;
        pen.fillStyle = n < picked ? "#cfe9ec" : n % 2 ? "#ffffff" : "#edf1f5"; pen.fillRect(12, y, 488, 34);
        pen.fillStyle = FILE_TYPES[n][1]; pen.fillRect(22, y + 6, 20, 22);
        pen.fillStyle = "#172029"; pen.font = "600 22px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif"; pen.fillText(file + FILE_TYPES[n][0], 54, y + 18);
      });
      pen.fillStyle = sent ? "#39c27d" : "#0e7c86"; pen.fillRect(300, 274, 200, 38);
      pen.fillStyle = "#ffffff"; pen.textAlign = "center"; pen.fillText(sent ? tx("folderSent", "Attached") : tx("folderSend", "Attach " + picked + " files"), 400, 294);
      folderMap.needsUpdate = true;
    }
    // the same files as cards, flying from the laptop to the assistant on the bench
    FILE_TYPES.forEach(function (ft, i) {
      var card = new THREE.Group();
      var back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.81, 0.02), std(0xdfe5ec, 0));
      var front = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.81), new THREE.MeshBasicMaterial({ map: fileTexture(ft[0], ft[1]) }));
      front.position.z = 0.012;
      card.add(back, front);
      card.userData = { delay: FILES_FLY[0] + i * (FILES_FLY[1] - FILES_FLY[0] - 0.14) / (FILE_TYPES.length - 1) };
      g.add(card); cards.push(card);
    });
    // the assistant's screen in this scene: the script, written line by line
    var page = document.createElement("canvas"), ink = page.getContext("2d"), pageShown = -1;
    page.width = 440; page.height = 512;
    var pageMap = new THREE.CanvasTexture(page);
    pageMap.colorSpace = THREE.SRGBColorSpace;
    shop.screen.material.map = pageMap;
    /** Redraw the assistant's screen with the first `lines` lines of the script. */
    function drawScript(lines) {
      if (lines === pageShown) return;
      pageShown = lines;
      ink.fillStyle = "#101a26"; ink.fillRect(0, 0, 440, 512);
      ink.fillStyle = "#f2c14e"; ink.font = "700 50px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif"; ink.textBaseline = "middle";
      ink.fillText(tx("scriptWord", "SCRIPT"), 30, 52);
      scenes.slice(0, lines).forEach(function (s, n) {
        ink.fillStyle = s.colour; ink.beginPath(); ink.arc(44, 112 + n * 33, 10, 0, Math.PI * 2); ink.fill();
        ink.fillStyle = "rgba(230, 235, 241, 0.8)"; ink.fillRect(70, 106 + n * 33, 150 + (n * 53) % 170, 12);
      });
      pageMap.needsUpdate = true;
    }
    var START = [0, 1.75, 1.15], END = [TOOL_X[0], BENCH_TOP + 0.5, BENCH_Z + 0.45];
    return {
      group: g,
      floor: false,
      accent: 0,
      shots: [
        { at: 0, from: [1.45, 3.0, -0.7], to: [1.15, 2.8, -0.45], look: [-0.05, 2.1, 1.2] },               // the folder, past the builder's shoulder: pick the files, attach them
        { at: FILES_FLY[0] - 0.02, from: [3.6, 3.3, 5.6], to: [1.8, 3.1, 5.0], look: [-1.7, 2.5, -0.4] },  // across the room: six files on their way
        { at: FILES_FLY[1], from: [-1.9, 2.6, 0.5], to: [-2.5, 2.5, -0.3], look: [TOOL_X[0], 2.3, BENCH_Z] }   // the assistant writes the script
      ],
      update: function (u, t) {
        var attached = u >= FILES_FLY[0] - 0.04;
        drawFolder(Math.min(PROJECT_FILES.length, Math.floor(span(u, 0.05, FILES_FLY[0] - 0.08) * (PROJECT_FILES.length + 1))), attached);
        var landed = 0;
        cards.forEach(function (card, i) {
          var k = inOutCubic(span(u, card.userData.delay, card.userData.delay + 0.14));
          card.position.copy(v3(START).lerp(v3(END), k));
          card.position.y += Math.sin(k * Math.PI) * 1.5;
          card.rotation.set(Math.sin(k * Math.PI) * 0.5, -1.1 * k + Math.sin(t * 2 + i) * 0.1, 0);
          card.scale.setScalar(Math.max(0.001, span(k, 0, 0.12) * (1 - span(k, 0.86, 1))));
          landed += k;
        });
        var reading = landed / cards.length;
        drawScript(Math.floor(span(u, FILES_FLY[1] - 0.04, 0.95) * (scenes.length + 1)));
        shop.drive([Math.max(0.25 * reading, smooth(span(u, FILES_FLY[1] - 0.06, FILES_FLY[1]))), 0, 0, 0], t);
        // the builder picks the files, presses attach, swivels round to watch them go, and is pleased with the script
        var press = Math.sin(Math.PI * span(u, FILES_FLY[0] - 0.07, FILES_FLY[0] - 0.03)), turned = smooth(span(u, FILES_FLY[0], FILES_FLY[0] + 0.07));
        var glad = smooth(span(u, 0.82, 0.9)), typing = 1 - smooth(span(u, FILES_FLY[0] - 0.08, FILES_FLY[0] - 0.07));
        set.swivel.rotation.y = Math.PI * 0.82 * turned;
        pose(hero, {
          sit: true, mood: glad > 0.4 ? "happy" : "calm", nod: lerp(0.2, -0.1, turned),
          lx: lerp(TYPING, -0.1, turned), lz: -ARMS_UP * 0.9 * glad, lb: lerp(TYPING_ELBOW - 0.45 * press, -0.45, turned),
          rx: lerp(TYPING, -0.1, turned), rz: ARMS_UP * 0.9 * glad, rb: lerp(TYPING_ELBOW, -0.45, turned)
        });
        tapFingers(hero.handL, t, typing * 0.5);
        tapFingers(hero.handR, t, typing * 0.5);
        set.light.intensity = SCREEN_GLOW;
      }
    };
  };

  /** A daytime building front: a pale wall, rows of blue glass and a shop front with an awning at street level. Four variants. */
  function dayFacadeTexture(variant) {
    return painted("dayfacade-" + variant, 256, 512, function (g, w, h) {
      var walls = ["#cbb9a2", "#b9c6d1", "#d6c5b2", "#adbac5"], awnings = ["#c2452b", "#1e7f5c", "#2a6db5", "#d98a0a"];
      g.fillStyle = walls[variant];
      g.fillRect(0, 0, w, h);
      for (var row = 0; row < 11; row++) {
        for (var col = 0; col < 5; col++) {
          g.fillStyle = (row + col + variant) % 3 ? "#6d9cc2" : "#9ccbe8";
          g.fillRect(18 + col * 46, 16 + row * 37, 30, 24);
        }
      }
      g.fillStyle = "#2b333d"; g.fillRect(0, h - 96, w, 96);
      g.fillStyle = "#9cc4e0"; g.fillRect(16, h - 78, w - 32, 66);
      g.fillStyle = awnings[variant]; g.fillRect(0, h - 108, w, 24);
    });
  }
  /** A street tree: a trunk and three overlapping crowns. */
  function tree() {
    var g = new THREE.Group(), leaf = std(0x3f9a5c, 0.08);
    g.add(rod([0, 0, 0], [0, 1.5, 0], 0.09, std(0x6b4a32, 0)));
    [[0, 2.1, 0, 0.8], [0.35, 1.8, 0.2, 0.55], [-0.3, 1.75, -0.2, 0.6]].forEach(function (c) {
      var crown = new THREE.Mesh(new THREE.IcosahedronGeometry(c[3], 1), leaf);
      crown.position.set(c[0], c[1], c[2]);
      g.add(crown);
    });
    return g;
  }
  /** A cloud: a few soft white balls. */
  function cloud() {
    var g = new THREE.Group(), white = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    [[0, 0, 0, 1.6], [1.6, 0.2, 0.2, 1.2], [-1.5, 0.1, -0.1, 1.1], [0.5, 0.7, 0, 1.0]].forEach(function (b) {
      var puff = new THREE.Mesh(new THREE.SphereGeometry(b[3], 14, 10), white);
      puff.position.set(b[0], b[1], b[2]);
      puff.scale.y = 0.6;
      g.add(puff);
    });
    return g;
  }

  builders.live3d = function (sc) {
    var g = new THREE.Group(), r = rng(57), towers = [], cars = [], walkers = [], trees = [], clouds = [];
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ color: 0x8f9aa6, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -20;
    var road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, 100), new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.6 }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.02, -24);
    g.add(ground, road);
    for (var stripe = 0; stripe < 6; stripe++) {
      var zebra = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 1.6), new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.8 }));
      zebra.rotation.x = -Math.PI / 2;
      zebra.position.set(-1.85 + stripe * 0.74, 0.03, 5);
      g.add(zebra);
    }
    var facades = [0, 1, 2, 3].map(function (v) { return new THREE.MeshStandardMaterial({ map: dayFacadeTexture(v), roughness: 0.75 }); });
    // every tower is drawn twice: first as the lines the code describes, then filled in
    for (var i = 0; i < TOWERS + SKYLINE; i++) {
      var far = i >= TOWERS, side = i % 2 ? 1 : -1, row = Math.floor((far ? i - TOWERS : i) / 2);
      var w = far ? 5 + r() * 3 : 3.0 + r() * 1.4, h = far ? 14 + r() * 16 : 5 + r() * 11, depth = far ? 5 : 3;
      var box = new THREE.BoxGeometry(w, h, depth);
      var solid = new THREE.Mesh(box, facades[i % facades.length]);
      var wire = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: BLUEPRINT, transparent: true }));
      var at = { x: side * (far ? 13 + r() * 5 : ROAD_WIDTH / 2 + PAVEMENT + w / 2 + r() * 0.6), z: far ? 10 - row * 6.5 : 12 - row * 3.6, h: h, delay: (far ? 0.03 : 0) + row * 0.012 };
      solid.userData = wire.userData = at;
      g.add(solid, wire); towers.push({ solid: solid, wire: wire });
    }
    for (var k = 0; k < 14; k++) {
      var tr = tree(), trSide = k % 2 ? 1 : -1;
      tr.position.set(trSide * (ROAD_WIDTH / 2 + 0.8), 0, 10 - Math.floor(k / 2) * 6.2);
      tr.userData = { delay: 0.1 + Math.floor(k / 2) * 0.012 };
      var post = rod([trSide * (ROAD_WIDTH / 2 + 0.5), 0, tr.position.z - 3.1], [trSide * (ROAD_WIDTH / 2 + 0.5), 3, tr.position.z - 3.1], 0.05, std(0x2b333d, 0));
      g.add(tr, post); trees.push(tr);
    }
    [0xc2452b, 0x2a6db5, 0xf2c14e, 0xe8edf2, 0x1e7f5c, 0x6a4bb5].forEach(function (colour, c) {
      var v = car(colour);
      v.userData = { toward: c % 2 === 1, offset: c / 6, speed: 0.1 + (c % 3) * 0.03, lead: c === 0 };
      v.rotation.y = v.userData.toward ? 0 : Math.PI;
      g.add(v); cars.push(v);
    });
    for (var n = 0; n < WALKERS; n++) {
      var w2 = person(CITY_COATS[n % CITY_COATS.length], { skin: SKIN_TONES[n % SKIN_TONES.length], hair: HAIR_TONES[n % HAIR_TONES.length] });
      w2.userData = { x: (n % 2 ? 1 : -1) * (ROAD_WIDTH / 2 + 1.7 + (n % 3) * 0.35), away: n % 3 === 0, offset: r(), step: r() * 6 };
      w2.group.rotation.y = w2.userData.away ? Math.PI : 0;
      g.add(w2.group); walkers.push(w2);
    }
    for (var c2 = 0; c2 < 7; c2++) {
      var puffs = cloud();
      puffs.userData = { x: (r() - 0.5) * 70, y: 22 + r() * 8, z: -10 - r() * 50, drift: 0.4 + r() * 0.5 };
      puffs.scale.setScalar(1.2 + r() * 1.4);
      g.add(puffs); clouds.push(puffs);
    }
    var sun = glowSprite(0xfff1c4, 40, 0.9);
    sun.material.fog = false;
    sun.position.set(-20, 30, -80);
    g.add(sun);
    // at the end of the street, a billboard playing the film
    var frames = [filmFrame(0), filmFrame(2), filmFrame(1)];
    var hoarding = new THREE.Mesh(new THREE.BoxGeometry(11.4, 6.6, 0.4), std(0x14181d, 0));
    hoarding.position.set(0, 9.6, BILLBOARD_Z - 0.25);
    var screen = new THREE.Mesh(new THREE.PlaneGeometry(10.8, 6.0), new THREE.MeshBasicMaterial({ map: frames[0], fog: false }));
    screen.position.set(0, 9.6, BILLBOARD_Z);
    g.add(hoarding, screen, rod([-3.5, 0, BILLBOARD_Z - 0.3], [-3.5, 6.4, BILLBOARD_Z - 0.3], 0.3, std(0x2b333d, 0)), rod([3.5, 0, BILLBOARD_Z - 0.3], [3.5, 6.4, BILLBOARD_Z - 0.3], 0.3, std(0x2b333d, 0)));
    return {
      group: g,
      floor: false,
      day: true,
      accent: 0,
      shots: [
        { at: 0, from: [0.9, 1.3, 13], to: [-0.7, 2.4, 8], look: [0, 7.5, -6], lookTo: [0, 6.5, -12] },                   // street level: the city draws itself
        { at: 0.26, from: [4.9, 1.5, 9.5], to: [4.9, 1.5, -16.5], look: [-1.1, 1.9, 7], lookTo: [-1.1, 1.9, -19] },       // alongside a car, people and trees flashing past
        { at: 0.52, from: [-19, 20, 8], to: [15, 23, -4], look: [0, 4, -12] },                                            // over the rooftops
        { at: 0.76, from: [0, 4.5, 4], to: [0, 9, -12], look: [0, 10.4, BILLBOARD_Z] }                                    // up to the billboard
      ],
      update: function (u, t) {
        towers.forEach(function (tw) {
          var d = tw.solid.userData, drawn = outCubic(span(u, d.delay, d.delay + 0.07)), built = outCubic(span(u, d.delay + 0.06, d.delay + 0.13));
          tw.wire.scale.y = Math.max(0.001, drawn);
          tw.wire.position.set(d.x, d.h * drawn / 2, d.z);
          tw.wire.material.opacity = 1 - span(u, d.delay + 0.12, d.delay + 0.18);
          tw.solid.scale.y = Math.max(0.001, built);
          tw.solid.position.set(d.x, d.h * built / 2, d.z);
          tw.solid.visible = built > 0.002;
        });
        trees.forEach(function (tr) { tr.scale.setScalar(Math.max(0.001, outCubic(span(u, tr.userData.delay, tr.userData.delay + 0.06)))); });
        var chase = span(u, 0.26, 0.52);
        cars.forEach(function (v) {
          var d = v.userData, run = frac(t * d.speed + d.offset);
          if (d.lead && u >= 0.26 && u < 0.52) v.position.set(-ROAD_WIDTH / 4, 0, 7 - chase * 26);
          else v.position.set(d.toward ? ROAD_WIDTH / 4 : -ROAD_WIDTH / 4, 0, d.toward ? -44 + run * 62 : 18 - run * 62);
        });
        walkers.forEach(function (w2) {
          var d = w2.userData, run = frac(t * 0.035 + d.offset), walk = stride(t * 7 + d.step);
          w2.group.position.x = d.x;
          w2.group.position.z = d.away ? 14 - run * 36 : -22 + run * 36;
          pose(w2, { mood: "happy", y: Math.abs(Math.sin(t * 7 + d.step)) * 0.05, lx: walk.rl * 0.8, rx: walk.ll * 0.8, ll: walk.ll, rl: walk.rl, lk: walk.lk, rk: walk.rk });
        });
        clouds.forEach(function (c) { c.position.set(c.userData.x + t * c.userData.drift, c.userData.y, c.userData.z); });
        var frame = frames[Math.floor(t * 0.6) % frames.length];
        if (screen.material.map !== frame) { screen.material.map = frame; screen.material.needsUpdate = true; }
      }
    };
  };

  /** A drawing surface for a screen inside the story: a canvas and its texture, plus `show(key, paint)` which repaints only
      when `key` changes. */
  function liveScreen(w, h) {
    var canvas = document.createElement("canvas"), pen = canvas.getContext("2d"), shown = null;
    canvas.width = w; canvas.height = h;
    var map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return {
      map: map,
      show: function (key, paint) {
        if (key === shown) return;
        shown = key;
        paint(pen, w, h);
        map.needsUpdate = true;
      }
    };
  }

  builders.voice = function (sc) {
    var shop = workshop(hex(sc.colour)), g = shop.group, set = shop.set, hero = set.builder, tags = [];
    var panel = liveScreen(512, 320), board = liveScreen(800, 448), FONT = "'Source Sans 3', 'Segoe UI', system-ui, sans-serif";
    set.display.material.map = panel.map;
    shop.wall.material.map = board.map;
    /** The laptop: one line of the script, a row of voices and a row of languages, with one of each chosen. */
    function drawPanel(voice, language, chosen) {
      panel.show(voice + "/" + language + "/" + chosen, function (pen, w, h) {
        pen.fillStyle = "#0f1722"; pen.fillRect(0, 0, w, h);
        pen.textBaseline = "middle"; pen.textAlign = "left";
        pen.fillStyle = "#b39ded"; pen.font = "700 26px " + FONT; pen.fillText(tx("voiceHead", "AI VOICE"), 22, 30);
        pen.fillStyle = "#1b2a3b"; pen.fillRect(18, 52, w - 36, 58);
        pen.fillStyle = "#ffffff"; pen.font = "600 24px " + FONT; pen.fillText(tx("voiceLine", "“You know this story.”"), 32, 82);
        [[VOICES, voice, 128, "#b39ded"], [LANGUAGES, language, 212, "#5fc5cf"]].forEach(function (row) {
          row[0].forEach(function (name, n) {
            var x = 18 + n * 122, on = n === row[1];
            pen.fillStyle = on ? row[3] : "#1b2a3b"; pen.fillRect(x, row[2], 112, 46);
            pen.fillStyle = on ? "#0f1722" : "#aeb7c1"; pen.font = "600 22px " + FONT; pen.textAlign = "center"; pen.fillText(name, x + 56, row[2] + 24);
          });
        });
        pen.fillStyle = chosen ? "#39c27d" : "#3a4654"; pen.fillRect(w - 170, 270, 152, 40);
        pen.fillStyle = "#ffffff"; pen.fillText(chosen ? tx("voiceDone", "Speaking") : tx("voiceGo", "Speak"), w - 94, 291);
      });
    }
    /** The wall screen: the film's scenes as blocks, the spoken lines as clips under them, a playhead, and one clip being redone. */
    function drawBoard(clips, head, redo) {
      board.show(clips + "/" + Math.round(head * 200) + "/" + redo, function (pen, w, h) {
        var left = 150, span2 = w - left - 24, at = 0;
        pen.fillStyle = "#101a26"; pen.fillRect(0, 0, w, h);
        pen.textBaseline = "middle"; pen.textAlign = "left"; pen.font = "700 26px " + FONT;
        pen.fillStyle = "#aeb7c1"; pen.fillText(tx("rowScenes", "SCENES"), 22, 150); pen.fillText(tx("rowVoice", "VOICE"), 22, 264);
        pen.fillStyle = "#ffffff"; pen.font = "700 34px " + FONT; pen.fillText(tx("boardHead", "Every line, timed to its scene"), 22, 52);
        scenes.forEach(function (s, n) {
          var x = left + at / TOTAL * span2, bw = s.dur / TOTAL * span2 - 4;
          pen.fillStyle = s.colour; pen.fillRect(x, 112, bw, 76);
          if (n < clips) {
            pen.fillStyle = n === REDO_CLIP && redo === 1 ? "#f2c14e" : n === REDO_CLIP && redo === 2 ? "#39c27d" : "#b39ded";
            pen.fillRect(x + 6, 232, bw * 0.62, 64);
          }
          at += s.dur;
        });
        pen.fillStyle = "#ffffff"; pen.fillRect(left + head * span2, 96, 4, 216);
        if (redo) {
          pen.fillStyle = redo === 1 ? "#f2c14e" : "#39c27d"; pen.font = "700 30px " + FONT;
          pen.fillText(redo === 1 ? tx("redoing", "One word changed: speaking that line again…") : tx("redone", "Done. The line is spoken again."), 22, 372);
        }
      });
    }
    // the big waveform over the voice tool, and what the tool offers
    var bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 1, 0.07), new THREE.MeshStandardMaterial({ color: hex(sc.deep), emissive: hex(sc.colour), emissiveIntensity: 0.9, roughness: 0.4 }), SPEECH_BARS);
    g.add(bars);
    VOICE_OFFERS.forEach(function (offer, i) {
      var chip = tag(tx("offer" + i, offer), 0.34);
      chip.position.set(TOOL_X[2] + (i - 1) * 2.1, BENCH_TOP + CLAIMS_UP, BENCH_Z + 0.5);
      g.add(chip); tags.push(chip);
    });
    return {
      group: g,
      floor: false,
      accent: 0,
      shots: [
        { at: 0, from: [1.45, 3.0, -0.7], to: [1.15, 2.8, -0.45], look: [-0.05, 2.1, 1.2] },                    // the laptop: choose a voice, choose a language
        { at: VOICE_CUTS[0], from: [4.0, 3.9, 5.4], to: [3.2, 3.7, 4.7], look: [TOOL_X[2], 3.95, BENCH_Z] },      // the bench: the voice tool speaks
        { at: VOICE_CUTS[1], from: [3.3, 2.9, 4.8], to: [2.2, 2.6, 3.6], look: [0.4, 3.7, WALL_Z] }              // the wall: every line lands on its scene
      ],
      update: function (u, t) {
        var picking = span(u, 0.04, VOICE_CUTS[0] - 0.06), chosen = u >= VOICE_CUTS[0] - 0.04;
        drawPanel(Math.min(VOICES.length - 1, Math.floor(picking * VOICES.length * 1.4) % VOICES.length), Math.min(LANGUAGES.length - 1, Math.floor(picking * 2.6) % LANGUAGES.length), chosen);
        // the floating waveform and the claims belong to the bench shot; they clear away before the wall screen takes over
        var speaking = smooth(span(u, VOICE_CUTS[0] - 0.02, VOICE_CUTS[0] + 0.04)), aloft = 1 - smooth(span(u, VOICE_CUTS[1] - 0.04, VOICE_CUTS[1]));
        shop.drive([0.7, 0.7, speaking, 0], t);
        for (var i = 0; i < SPEECH_BARS; i++) {
          var edge = Math.sin(Math.PI * i / (SPEECH_BARS - 1));
          var tall = 0.001 + aloft * speaking * edge * 1.2 * Math.abs(Math.sin(t * 6.2 + i * 0.42)) * (0.35 + 0.65 * Math.abs(Math.sin(t * 2.1 + i * 0.13)));
          dummy.position.set(TOOL_X[2] + (i - (SPEECH_BARS - 1) / 2) * 0.1, BENCH_TOP + WAVE_UP, BENCH_Z + 0.1);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, tall, 1);
          dummy.updateMatrix();
          bars.setMatrixAt(i, dummy.matrix);
        }
        bars.instanceMatrix.needsUpdate = true;
        bars.visible = aloft > 0.01;
        tags.forEach(function (chip, n) {
          var pop = outCubic(span(u, VOICE_CUTS[0] + 0.03 + n * 0.05, VOICE_CUTS[0] + 0.08 + n * 0.05)) * aloft;
          chip.scale.set(Math.max(0.001, 0.34 * 4 * pop), Math.max(0.001, 0.34 * pop), 1);
        });
        var fill = span(u, VOICE_CUTS[1], VOICE_CUTS[2]), redo = u < VOICE_CUTS[2] ? 0 : u < VOICE_CUTS[2] + 0.1 ? 1 : 2;
        drawBoard(Math.floor(fill * (scenes.length + 0.99)), span(u, VOICE_CUTS[1], 1), redo);
        shop.wall.material.opacity = smooth(span(u, VOICE_CUTS[1] - 0.05, VOICE_CUTS[1]));
        // the builder: clicks through the choices, swivels round to listen, and nods along
        var turned = smooth(span(u, VOICE_CUTS[0] - 0.03, VOICE_CUTS[0] + 0.05)), glad = smooth(span(u, VOICE_CUTS[2] + 0.1, VOICE_CUTS[2] + 0.16));
        set.swivel.rotation.y = Math.PI * turned;
        pose(hero, {
          sit: true, mood: turned > 0.5 ? "happy" : "calm", nod: lerp(0.2, -0.1 + Math.sin(t * 6.2) * 0.07, turned),
          lx: lerp(TYPING, -0.1, turned), lz: -ARMS_UP * 0.9 * glad, lb: lerp(TYPING_ELBOW + Math.sin(t * 5) * 0.12, -0.45, turned),
          rx: lerp(TYPING, -0.1, turned), rz: ARMS_UP * 0.9 * glad, rb: lerp(TYPING_ELBOW, -0.45, turned)
        });
        set.light.intensity = SCREEN_GLOW;
      }
    };
  };

  builders.score = function (sc) {
    var shop = workshop(hex(sc.colour)), g = shop.group, set = shop.set, hero = set.builder, layers = [];
    var panel = liveScreen(512, 320), board = liveScreen(800, 448), FONT = "'Source Sans 3', 'Segoe UI', system-ui, sans-serif";
    set.display.material.map = panel.map;
    shop.wall.material.map = board.map;
    /** The laptop: the track's key and tempo light up in turn (-1 is not yet), then compose. */
    function drawPanel(mood, tempo, composing) {
      panel.show(mood + "/" + tempo + "/" + composing, function (pen, w, h) {
        pen.fillStyle = "#0f1722"; pen.fillRect(0, 0, w, h);
        pen.textBaseline = "middle"; pen.textAlign = "left";
        pen.fillStyle = "#ef8578"; pen.font = "700 26px " + FONT; pen.fillText(tx("musicHead", "BACKING TRACK"), 22, 30);
        pen.fillStyle = "#aeb7c1"; pen.font = "600 20px " + FONT; pen.fillText(tx("musicKey", "Key"), 22, 74); pen.fillText(tx("musicTempo", "Tempo"), 22, 176);
        [[MUSIC_KEY, mood, 92, "#ef8578", 162], [MUSIC_TEMPO, tempo, 194, "#f2c14e", 162]].forEach(function (row) {
          row[0].forEach(function (name, n) {
            var x = 18 + n * row[4], on = n === row[1];
            pen.fillStyle = on ? row[3] : "#1b2a3b"; pen.fillRect(x, row[2], row[4] - 10, 46);
            pen.fillStyle = on ? "#0f1722" : "#aeb7c1"; pen.font = "600 22px " + FONT; pen.textAlign = "center"; pen.fillText(name, x + (row[4] - 10) / 2, row[2] + 24);
            pen.textAlign = "left";
          });
        });
        pen.fillStyle = composing ? "#39c27d" : "#3a4654"; pen.fillRect(w - 190, 266, 172, 42);
        pen.fillStyle = "#ffffff"; pen.textAlign = "center"; pen.font = "600 22px " + FONT; pen.fillText(composing ? tx("musicDone", "Composing") : tx("musicGo", "Compose"), w - 104, 288);
      });
    }
    /** The wall screen: the scenes, and under them the four layers of the music, each entering at its scene and growing; then
        the note about where the music comes from. */
    function drawBoard(head, stamped) {
      board.show(Math.round(head * 160) + "/" + stamped, function (pen, w, h) {
        var left = 150, span2 = w - left - 24;
        pen.fillStyle = "#101a26"; pen.fillRect(0, 0, w, h);
        pen.textBaseline = "middle"; pen.textAlign = "left";
        pen.fillStyle = "#ffffff"; pen.font = "700 34px " + FONT; pen.fillText(tx("musicBoard", "A backing track that builds with the story"), 22, 46);
        pen.font = "700 22px " + FONT; pen.fillStyle = "#aeb7c1"; pen.fillText(tx("rowScenes", "SCENES"), 22, 106);
        var at = 0, starts = [];
        scenes.forEach(function (s) {
          starts.push(at / TOTAL);
          pen.fillStyle = s.colour; pen.fillRect(left + at / TOTAL * span2, 84, s.dur / TOTAL * span2 - 4, 44);
          at += s.dur;
        });
        MUSIC_LAYERS.forEach(function (layer, n) {
          var y = 152 + n * 46, from = starts[layer.from], upTo = Math.max(from, head);
          pen.fillStyle = "#aeb7c1"; pen.font = "700 22px " + FONT; pen.fillText(tx("layer" + n, layer.name).toUpperCase(), 22, y + 18);
          pen.fillStyle = "#1b2a3b"; pen.fillRect(left, y, span2, 36);
          pen.fillStyle = layer.colour;
          for (var x = from; x < upTo; x += 0.012) pen.fillRect(left + x * span2, y + 18 - 4 - 12 * (x - from) / (1 - from + 0.01), span2 * 0.008, 8 + 24 * (x - from) / (1 - from + 0.01));
        });
        pen.fillStyle = "#ffffff"; pen.fillRect(left + head * span2, 76, 4, 264);
        if (stamped) {
          pen.fillStyle = "#39c27d"; pen.fillRect(22, 356, w - 44, 70);
          pen.fillStyle = "#0f1722"; pen.font = "700 30px " + FONT; pen.textAlign = "center";
          pen.fillText(tx("musicStamp", "Instrumental only · no song copied · no artist imitated · no samples"), w / 2, 392, w - 70);
        }
      });
    }
    // over the keyboard: one name tag and one cluster of level bars per layer of the music
    var bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 1, 0.06), new THREE.MeshStandardMaterial({ color: hex(sc.deep), emissive: hex(sc.colour), emissiveIntensity: 0.9, roughness: 0.4 }), MUSIC_LAYERS.length * LAYER_BARS);
    g.add(bars);
    MUSIC_LAYERS.forEach(function (layer, i) {
      var chip = tag(tx("layer" + i, layer.name), 0.34), x = TOOL_X[3] + (i - 1.5) * 1.5 - 1.2;
      chip.position.set(x, BENCH_TOP + CLAIMS_UP, BENCH_Z + 0.5);
      g.add(chip); layers.push({ chip: chip, x: x, at: MUSIC_CUTS[0] + 0.02 + i * 0.045 });
    });
    return {
      group: g,
      floor: false,
      accent: 0,
      shots: [
        { at: 0, from: [1.45, 3.0, -0.7], to: [1.15, 2.8, -0.45], look: [-0.05, 2.1, 1.2] },                         // the laptop: a mood, a tempo, compose
        { at: MUSIC_CUTS[0], from: [4.6, 3.9, 5.6], to: [3.8, 3.7, 4.9], look: [TOOL_X[3] - 1.2, 3.95, BENCH_Z] },    // the bench: the layers come in one by one
        { at: MUSIC_CUTS[1], from: [3.3, 2.9, 4.8], to: [2.2, 2.6, 3.6], look: [0.4, 3.7, WALL_Z] }                   // the wall: how it follows the story, and whose it is
      ],
      update: function (u, t) {
        var picking = span(u, 0.04, MUSIC_CUTS[0] - 0.06), composing = u >= MUSIC_CUTS[0] - 0.04;
        drawPanel(picking > 0.3 ? 0 : -1, picking > 0.6 ? 0 : -1, composing);
        var playing = smooth(span(u, MUSIC_CUTS[0] - 0.02, MUSIC_CUTS[0] + 0.04)), aloft = 1 - smooth(span(u, MUSIC_CUTS[1] - 0.04, MUSIC_CUTS[1]));
        shop.drive([0.7, 0.7, 0.7, playing], t);
        layers.forEach(function (layer, n) {
          var on = outCubic(span(u, layer.at, layer.at + 0.04)) * aloft, beat = Math.exp(-frac(t * 2.1 + n * 0.25) * 4);
          layer.chip.scale.set(Math.max(0.001, 0.34 * 4 * on), Math.max(0.001, 0.34 * on), 1);
          for (var i = 0; i < LAYER_BARS; i++) {
            var tall = 0.001 + on * (0.25 + 0.9 * Math.abs(Math.sin(t * (4 + n) + i * 0.9)) * (0.4 + 0.6 * beat));
            dummy.position.set(layer.x + (i - (LAYER_BARS - 1) / 2) * 0.11, BENCH_TOP + WAVE_UP - 0.6 + tall / 2, BENCH_Z + 0.1);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, tall, 1);
            dummy.updateMatrix();
            bars.setMatrixAt(n * LAYER_BARS + i, dummy.matrix);
          }
        });
        bars.instanceMatrix.needsUpdate = true;
        bars.visible = aloft > 0.01;
        drawBoard(span(u, MUSIC_CUTS[1], MUSIC_CUTS[2]), u >= MUSIC_CUTS[2]);
        shop.wall.material.opacity = smooth(span(u, MUSIC_CUTS[1] - 0.05, MUSIC_CUTS[1]));
        // the builder: picks, composes, swivels round, and moves to the beat
        var turned = smooth(span(u, MUSIC_CUTS[0] - 0.03, MUSIC_CUTS[0] + 0.05)), glad = smooth(span(u, MUSIC_CUTS[2], MUSIC_CUTS[2] + 0.06)), pulse = Math.exp(-frac(t * 2.1) * 5) * turned;
        set.swivel.rotation.y = Math.PI * turned;
        pose(hero, {
          sit: true, mood: turned > 0.5 ? "happy" : "calm", nod: lerp(0.2, -0.05 + 0.2 * pulse, turned),
          lx: lerp(TYPING, -0.3, turned), lz: -ARMS_UP * 0.9 * glad, lb: lerp(TYPING_ELBOW + Math.sin(t * 5) * 0.12, -0.9 + 0.3 * pulse, turned),
          rx: lerp(TYPING, -0.3, turned), rz: ARMS_UP * 0.9 * glad, rb: lerp(TYPING_ELBOW, -0.9 + 0.3 * pulse, turned)
        });
        set.light.intensity = SCREEN_GLOW;
      }
    };
  };

  builders.onefile = function (sc) {
    var shop = workshop(hex(sc.colour)), g = shop.group, set = shop.set, hero = set.builder, N = data.facts.seconds, sparks = [];
    var panel = liveScreen(512, 320), board = liveScreen(800, 448), pocket = liveScreen(256, 512), FONT = "'Source Sans 3', 'Segoe UI', system-ui, sans-serif";
    var frames = [filmFrame(0), filmFrame(1), filmFrame(2)];
    set.display.material.map = panel.map;
    shop.wall.material.map = board.map;
    // a phone on a little stand beside the laptop, its screen towards the builder
    var phone = slab([0.2, 0.4], pocket.map), rest = new THREE.Group();
    phone.rotation.y = Math.PI;
    phone.position.y = 0.2;
    var lean = new THREE.Group();
    lean.rotation.x = 0.3;
    lean.add(phone);
    var foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.14), std(0x39414d, 0));
    foot.position.set(0, 0.01, 0.03);
    rest.add(lean, foot);
    rest.position.set(0.78, 1.02, 0.86);
    g.add(rest);
    /** The film in a browser window: a title bar naming the file, the current frame, a progress line. */
    function drawBrowser(pen, w, h, frame, progress) {
      var bar = Math.round(h * 0.13);
      pen.fillStyle = "#2a323c"; pen.fillRect(0, 0, w, h);
      pen.fillStyle = "#ef8578"; pen.beginPath(); pen.arc(bar * 0.5, bar / 2, bar * 0.16, 0, Math.PI * 2); pen.fill();
      pen.fillStyle = "#f2c14e"; pen.beginPath(); pen.arc(bar * 1.0, bar / 2, bar * 0.16, 0, Math.PI * 2); pen.fill();
      pen.fillStyle = "#11161c"; pen.fillRect(bar * 1.6, bar * 0.18, w - bar * 2.2, bar * 0.64);
      pen.fillStyle = "#d6dde6"; pen.font = "600 " + Math.round(bar * 0.42) + "px " + FONT; pen.textBaseline = "middle"; pen.textAlign = "left";
      pen.fillText(FILM_FILE, bar * 1.9, bar / 2 + 1);
      pen.drawImage(frames[frame].image, 0, bar, w, h - bar);
      pen.fillStyle = "rgba(11, 16, 23, 0.7)"; pen.fillRect(0, h - 10, w, 10);
      pen.fillStyle = "#5fc5cf"; pen.fillRect(0, h - 10, w * progress, 10);
    }
    /** The laptop: the film playing, or the export panel with its progress bar. */
    function drawPanel(mode, frame, progress) {
      panel.show(mode + "/" + frame + "/" + Math.round(progress * 60), function (pen, w, h) {
        if (mode === "film") { drawBrowser(pen, w, h, frame, progress); return; }
        pen.fillStyle = "#0f1722"; pen.fillRect(0, 0, w, h);
        pen.textBaseline = "middle"; pen.textAlign = "left";
        pen.fillStyle = "#6fcf9f"; pen.font = "700 28px " + FONT; pen.fillText(tx("exportHead", "EXPORT VIDEO"), 24, 40);
        pen.fillStyle = "#ffffff"; pen.font = "600 26px " + FONT; pen.fillText(FILM_FILE + "   →   " + VIDEO_FILE, 24, 104);
        pen.fillStyle = "#1b2a3b"; pen.fillRect(24, 150, w - 48, 40);
        pen.fillStyle = "#6fcf9f"; pen.fillRect(24, 150, (w - 48) * progress, 40);
        pen.fillStyle = "#aeb7c1"; pen.font = "600 24px " + FONT;
        pen.fillText(progress >= 1 ? tx("exportDone", "Done. Your film is now a video file.") : tx("exportBusy", "Recording every frame…"), 24, 232);
      });
    }
    /** The wall screen: the one file arriving, then the film in a browser, then the video file and where it can go. */
    function drawBoard(mode, frame, progress) {
      board.show(mode + "/" + frame + "/" + Math.round(progress * 80), function (pen, w, h) {
        if (mode === "film") { drawBrowser(pen, w, h, frame, progress); return; }
        pen.fillStyle = "#101a26"; pen.fillRect(0, 0, w, h);
        pen.textBaseline = "middle"; pen.textAlign = "center";
        var video = mode === "share", cx = video ? 190 : w / 2, grow = video ? 1 : Math.min(1, progress * 1.2);
        // a document icon with a folded corner
        pen.save(); pen.translate(cx, 214); pen.scale(grow, grow);
        pen.fillStyle = "#f4f6f8"; pen.beginPath(); pen.moveTo(-90, -120); pen.lineTo(50, -120); pen.lineTo(90, -80); pen.lineTo(90, 120); pen.lineTo(-90, 120); pen.closePath(); pen.fill();
        pen.fillStyle = "#c9d2dc"; pen.beginPath(); pen.moveTo(50, -120); pen.lineTo(50, -80); pen.lineTo(90, -80); pen.closePath(); pen.fill();
        pen.fillStyle = video ? "#c2452b" : "#1e7f5c"; pen.fillRect(-90, 44, 180, 76);
        pen.fillStyle = "#ffffff"; pen.font = "700 44px " + FONT; pen.fillText(video ? ".mp4" : ".html", 0, 84);
        pen.fillStyle = video ? "#c2452b" : "#1e7f5c"; pen.beginPath(); pen.moveTo(-22, -62); pen.lineTo(34, -30); pen.lineTo(-22, 2); pen.closePath(); pen.fill();
        pen.restore();
        pen.fillStyle = "#ffffff"; pen.font = "700 40px " + FONT;
        if (!video) { pen.fillText(tx("oneFile", "Everything, in one file"), w / 2, 392); return; }
        pen.textAlign = "left"; pen.fillText(tx("shareHead", "Share it as a video"), 360, 70);
        SHARE_TO.forEach(function (place, n) {
          if (progress * SHARE_TO.length < n + 0.2) return;
          pen.fillStyle = "#1b2a3b"; pen.fillRect(360, 112 + n * 74, 400, 60);
          pen.fillStyle = "#6fcf9f"; pen.beginPath(); pen.arc(392, 142 + n * 74, 12, 0, Math.PI * 2); pen.fill();
          pen.fillStyle = "#ffffff"; pen.font = "600 30px " + FONT; pen.fillText(tx("share" + n, place), 422, 143 + n * 74);
        });
      });
    }
    // four sparks, one from each tool, fly to the wall screen where the file takes shape
    TOOLS.forEach(function (tool, i) {
      var spark = glowSprite(hex(tool.colour), 0.8, 0);
      g.add(spark); sparks.push(spark);
    });
    var LAPTOP_CAM = { from: [1.45, 3.0, -0.7], to: [1.15, 2.8, -0.45], look: [-0.05, 2.1, 1.2] }, WALL_CAM = { from: [3.3, 2.9, 4.8], to: [2.2, 2.6, 3.6], look: [0.4, 3.7, WALL_Z] };
    /** One of the scene's shots: the named camera, starting at scene progress `at`. */
    function shot(at, cam) { return { at: at, from: cam.from, to: cam.to, look: cam.look }; }
    return {
      group: g,
      floor: false,
      accent: 0,
      shots: [
        shot(0, { from: [4.4, 3.6, 5.6], to: [3.0, 3.2, 4.6], look: [0.4, 3.3, WALL_Z] }),             // four tools, one file
        shot(FILE_CUTS[0], LAPTOP_CAM),                                                                  // it plays on the laptop
        shot(FILE_CUTS[1], { from: [1.5, 2.0, 0.0], to: [1.3, 1.95, 0.2], look: [0.78, 2.05, 0.86] }),   // ... on the phone
        shot(FILE_CUTS[2], WALL_CAM),                                                                    // ... on the big screen
        shot(FILE_CUTS[3], LAPTOP_CAM),                                                                  // export a video
        shot(FILE_CUTS[4], WALL_CAM)                                                                     // and post it anywhere
      ],
      update: function (u, t) {
        shop.drive([1, 1, 1, 1], t);
        var frame = Math.floor(t * 0.8) % frames.length, playhead = frac(t * 0.07);
        sparks.forEach(function (spark, i) {
          var k = inOutCubic(span(u, 0.03 + i * 0.03, 0.17 + i * 0.03)), from = [TOOL_X[i], BENCH_TOP + 0.5, BENCH_Z + 0.3];
          spark.position.copy(v3(from).lerp(v3([0.5, 3.75, WALL_Z + 0.3]), k));
          spark.position.z += Math.sin(k * Math.PI) * 1.2;
          spark.material.opacity = 0.95 * Math.sin(k * Math.PI);
        });
        var exporting = span(u, FILE_CUTS[3] + 0.03, FILE_CUTS[4] - 0.04);
        if (u < FILE_CUTS[3]) drawPanel("film", frame, playhead);
        else drawPanel("export", 0, exporting);
        if (u < FILE_CUTS[0]) drawBoard("file", 0, span(u, 0.1, 0.24));
        else if (u < FILE_CUTS[4] - 0.02) drawBoard("film", frame, playhead);
        else drawBoard("share", 0, span(u, FILE_CUTS[4], 0.96));
        pocket.show(frame + "/" + Math.round(playhead * 40), function (pen, w, h) {
          pen.fillStyle = "#0b1017"; pen.fillRect(0, 0, w, h);
          pen.drawImage(frames[frame].image, 0, h * 0.34, w, w * 9 / 16);
          pen.fillStyle = "#5fc5cf"; pen.fillRect(0, h * 0.34 + w * 9 / 16 + 8, w * playhead, 8);
        });
        shop.wall.material.opacity = smooth(span(u, 0.06, 0.12));
        // the builder faces the wall for the file, the laptop for the first screens, the wall again, the laptop to export, the wall to cheer
        var toWall = 1 - smooth(span(u, FILE_CUTS[0] - 0.04, FILE_CUTS[0])) + smooth(span(u, FILE_CUTS[2] - 0.03, FILE_CUTS[2])) - smooth(span(u, FILE_CUTS[3] - 0.03, FILE_CUTS[3])) + smooth(span(u, FILE_CUTS[4] - 0.03, FILE_CUTS[4]));
        var press = Math.sin(Math.PI * span(u, FILE_CUTS[3], FILE_CUTS[3] + 0.04)), glad = smooth(span(u, FILE_CUTS[4] + 0.02, FILE_CUTS[4] + 0.08));
        set.swivel.rotation.y = Math.PI * toWall;
        pose(hero, {
          sit: true, mood: "happy", nod: lerp(0.2, -0.1, toWall),
          lx: lerp(TYPING, -0.1, toWall), lz: -ARMS_UP * 0.9 * glad, lb: lerp(TYPING_ELBOW - 0.45 * press, -0.45, toWall),
          rx: lerp(TYPING, -0.1, toWall), rz: ARMS_UP * 0.9 * glad, rb: lerp(TYPING_ELBOW, -0.45, toWall)
        });
        set.light.intensity = SCREEN_GLOW;
      },
      counter: { to: N, unit: tx("counted", " seconds · " + scenes.length + " scenes · 1 file"), from: 0.06, until: 0.24 }
    };
  };

  /* --- act three: the payoff --- */

  builders.premiere = function (sc) {
    var g = new THREE.Group(), hero = person(BUILDER), front = [], crowd = [];
    var hall = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.MeshStandardMaterial({ color: 0x2a1f24, roughness: 0.95 }));
    hall.rotation.x = -Math.PI / 2;
    hall.position.z = 4;
    var backWall = new THREE.Mesh(new THREE.PlaneGeometry(40, 14), new THREE.MeshStandardMaterial({ color: 0x1b1418, roughness: 1 }));
    backWall.position.set(0, 7, CINEMA_SCREEN_Z - 0.4);
    backWall.userData.noCast = true;
    g.add(hall, backWall);
    // the screen shows this film: frames of the scenes before, captured from the film itself once everything is built
    var stills = PREMIERE_STILLS.map(function (shot) {
      var canvas = document.createElement("canvas");
      canvas.width = 640; canvas.height = 360;
      var map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      return { id: shot[0], u: shot[1], canvas: canvas, map: map };
    });
    var screen = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 5.96), new THREE.MeshBasicMaterial({ map: stills[0].map, fog: false }));
    screen.position.set(0, 4.6, CINEMA_SCREEN_Z);
    var bezel = new THREE.Mesh(new THREE.BoxGeometry(11.0, 6.36, 0.2), std(0x0b0d10, 0));
    bezel.position.set(0, 4.6, CINEMA_SCREEN_Z - 0.15);
    var bar = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 0.08), new THREE.MeshBasicMaterial({ color: hex(sc.colour) }));
    bar.position.set(0, 1.7, CINEMA_SCREEN_Z + 0.02);
    var wash = new THREE.PointLight(0xfff1dc, 60, 0, 2);
    wash.position.set(0, 4.5, CINEMA_SCREEN_Z + 2.5);
    g.add(bezel, screen, bar, wash);
    // the front row is the meeting from before: the same six colleagues, phones down this time
    MEETING_COATS.forEach(function (coat, i) {
      var who = person(coat, { skin: SKIN_TONES[i % SKIN_TONES.length], hair: HAIR_TONES[(i + 2) % HAIR_TONES.length], trousers: 0x2b2f38 });
      who.group.rotation.y = Math.PI;
      who.group.position.set((i - 2.5) * 1.35, 0, FRONT_ROW_Z);
      who.userData = { phase: i * 0.9 };
      g.add(who.group); front.push(who);
    });
    for (var row = 0; row < AUDIENCE_ROWS; row++) {
      for (var seat = 0; seat < AUDIENCE_SEATS; seat++) {
        var fan = person(SILHOUETTE, { silhouette: true });
        fan.group.rotation.y = Math.PI;
        fan.group.position.set((seat - (AUDIENCE_SEATS - 1) / 2) * 1.3 + (row % 2) * 0.6, 0, FRONT_ROW_Z + 1.7 + row * 1.6);
        fan.userData = { phase: seat * 0.45 + row * 0.9 };
        g.add(fan.group); crowd.push(fan);
      }
    }
    hero.group.position.set(-6.6, 0, CINEMA_SCREEN_Z + 2.4);
    hero.group.rotation.y = 0.5;
    g.add(hero.group);
    var bits = [confetti(160, 61, hex(sc.colour)), confetti(160, 62, 0x5fc5cf), confetti(160, 63, 0xef8578)];
    bits.forEach(function (b) { g.add(b); });
    return {
      group: g,
      floor: false,
      accent: 0,
      stills: stills,
      shots: [
        { at: 0, from: [0, 4.8, 15.5], to: [0, 4.0, 12.5], look: [0, 4.6, CINEMA_SCREEN_Z] },                                           // the hall: your film on the big screen
        { at: 0.36, from: [-3.6, 2.2, FRONT_ROW_Z - 2.6], to: [3.6, 2.2, FRONT_ROW_Z - 2.6], look: [-3.2, 2.55, FRONT_ROW_Z], lookTo: [3.2, 2.55, FRONT_ROW_Z] },   // the same colleagues, watching
        { at: 0.68, from: [-1.4, 2.9, 5.6], to: [-2.4, 2.8, 4.4], look: [-3.6, 3.9, CINEMA_SCREEN_Z + 0.6] }                             // the builder beside the screen
      ],
      update: function (u, t) {
        var now = stills[Math.floor(t * 0.85) % stills.length];
        if (screen.material.map !== now.map) { screen.material.map = now.map; screen.material.needsUpdate = true; }
        bar.scale.x = Math.max(0.001, frac(t * 0.85));
        bar.position.x = -5.3 + 5.3 * bar.scale.x;
        wash.intensity = 55 + 12 * Math.sin(t * 3);
        front.forEach(function (who) {
          // clapping: forearms up in front, hands beating together
          var beat = Math.abs(Math.sin(t * 9 + who.userData.phase));
          pose(who, { mood: "happy", nod: -0.22, y: 0.03 * beat, lx: -1.2, lz: 0.5 - 0.25 * beat, lb: -1.5, rx: -1.2, rz: -0.5 + 0.25 * beat, rb: -1.5 });
        });
        crowd.forEach(function (fan) {
          var up = smooth(span(u, 0.1, 0.3)) * (0.4 + 0.6 * Math.abs(Math.sin(t * 2 - fan.userData.phase)));
          pose(fan, { y: Math.abs(Math.sin(t * 5 - fan.userData.phase)) * 0.18 * up, nod: -0.25, lz: -ARMS_UP * up, rz: ARMS_UP * up, lb: -0.4, rb: -0.4 });
        });
        cheer(hero, smooth(span(u, 0.62, 0.74)), t);
        bits.forEach(function (bit) { moveConfetti(bit, t); bit.material.opacity = 0.95 * span(u, 0.15, 0.3); });
      }
    };
  };

  builders.close = function (sc) {
    var g = new THREE.Group(), hero = person(BUILDER), credits = [];
    hero.group.position.set(4.6, 0, 2.4);
    hero.group.rotation.y = -0.45;
    g.add(hero.group);
    var mark = playMark(hex(sc.deep), 0.7);
    mark.position.set(0.05, CREDITS_TOP + 1.15, 0);
    g.add(mark);
    // whose film this is: the author named in scenes.json, above everything else in the credits
    if (data.author) {
      var byline = label(tx("byline", "A film by " + data.author), "#ffe2a6", 0.62);
      byline.position.set(0, CREDITS_TOP, 0.4);
      g.add(byline);
    }
    // the credits: the prompt, then each tool the film was made with, by name and by what it did
    CREDITS.forEach(function (credit, i) {
      var name = tag(tx("credit" + i, credit[0]), 0.46), role = label(tx("creditRole" + i, credit[1]), "#d6dde6", 0.34);
      var x = (i % 3 - 1) * 3.5, y = CREDITS_TOP - 1.0 - Math.floor(i / 3) * 1.05;
      name.position.set(x, y, 0.4);
      role.position.set(x, y - 0.46, 0.4);
      g.add(name, role);
      credits.push({ name: name, role: role, ratio: role.scale.x / role.scale.y, at: 0.06 + i * 0.07 });
    });
    var d = dust(500, 5, hex(sc.colour));
    g.add(d);
    return {
      group: g,
      cam: { from: [0, 3.6, 15], to: [0, 3.5, 13.2], look: [0, 4.3, 0] },
      update: function (u, t) {
        credits.forEach(function (c) {
          var pop = outCubic(span(u, c.at, c.at + 0.1));
          c.name.scale.set(Math.max(0.001, 0.46 * 4 * pop), Math.max(0.001, 0.46 * pop), 1);
          c.role.scale.set(Math.max(0.001, 0.34 * c.ratio * pop), Math.max(0.001, 0.34 * pop), 1);
        });
        mark.rotation.y = Math.sin(t * 0.5) * 0.35;
        mark.material.emissiveIntensity = 0.6 + 0.2 * Math.sin(t * 2);
        pose(hero, { mood: "happy", y: Math.abs(Math.sin(t * 4)) * 0.08, nod: -0.1, rz: 2.4 + Math.sin(t * 8) * 0.4, rb: -0.5, lx: -0.1 });
        moveDust(d, t);
      }
    };
  };

  /* ---------- director ---------- */
  var built = scenes.map(function () { return null; });
  function ensure(i) {
    if (built[i]) return built[i];
    var b = builders[scenes[i].id](scenes[i]);
    b.group.traverse(function (o) {
      if (o.isMesh && !o.material.transparent && !o.material.isMeshBasicMaterial) { o.castShadow = !o.userData.noCast; o.receiveShadow = true; }
    });
    b.group.visible = false;
    scene.add(b.group);
    built[i] = b;
    return b;
  }

  var el = {
    film: document.querySelector(".film"), fade: document.getElementById("fade"), lower: document.getElementById("lower"),
    kicker: document.getElementById("kicker"), title: document.getElementById("title"), line: document.getElementById("line"),
    stat: document.getElementById("stat"), code: document.getElementById("code"), end: document.getElementById("end"),
    play: document.getElementById("play"), restart: document.getElementById("restart"), seek: document.getElementById("seek"),
    time: document.getElementById("time"), chapters: document.getElementById("chapters"), sound: document.getElementById("sound"),
    full: document.getElementById("full"), poster: document.getElementById("poster"), posterPlay: document.getElementById("poster-play"),
    replay: document.getElementById("replay"), playIcon: document.getElementById("play-icon"),
    caption: document.getElementById("caption"), cc: document.getElementById("cc")
  };
  var T = 0, playing = false, current = -1, lastInput = 0, idleTimer = null;
  var clock = new THREE.Clock();

  function setTitles(sc) {
    el.kicker.textContent = sc.kicker;
    el.kicker.style.color = sc.colour;
    el.title.textContent = sc.title;
    el.line.textContent = sc.line;
    var b = built[current];
    el.code.hidden = !b.code;
    if (b.code) el.code.textContent = b.code;
    el.stat.hidden = !b.counter;
    el.lower.classList.remove("in", "out");
    void el.lower.offsetWidth;
    el.lower.classList.add("in");
    el.film.style.setProperty("--scene", sc.colour);
  }

  function enter(i) {
    if (current >= 0 && built[current]) built[current].group.visible = false;
    current = i;
    var b = ensure(i);
    b.group.visible = true;
    floor.visible = b.floor !== false;
    accent.color.setHex(hex(scenes[i].colour));
    accent.intensity = b.accent === undefined ? ACCENT_LIGHT : b.accent;
    // a scene marked `day` is outdoors in daylight: a pale sky, thinner haze and stronger fill light
    el.film.classList.toggle("day", !!b.day);   // the titles get a heavier shadow over a bright picture
    scene.background.setHex(b.day ? DAY_BG : BG);
    scene.fog.color.setHex(b.day ? DAY_BG : BG);
    scene.fog.density = b.day ? DAY_HAZE : NIGHT_HAZE;
    ambient.color.setHex(b.day ? WHITE : NIGHT_FILL);
    hemi.groundColor.setHex(b.day ? 0x8d96a0 : BG);
    ambient.intensity = b.day ? 1.2 : AMBIENT_LIGHT;
    hemi.intensity = b.day ? 1.8 : HEMI_LIGHT;
    setTitles(scenes[i]);
    el.end.hidden = true;
    markChapter(i);
  }

  function markChapter(i) {
    Array.prototype.forEach.call(el.chapters.children, function (c, k) { c.setAttribute("aria-current", k === i ? "true" : "false"); });
  }

  /** Camera for scene i at progress u; a scene with `shots` cuts between several camera moves, each starting at its `at`.
      Otherwise an eased move from `from` to `to`, looking at `look` (or towards `lookTo`), with a slow hand drift. */
  function placeCamera(b, u, t) {
    var k = inOutCubic(u), c = b.cam;
    if (b.shots) {
      var n = 0;
      while (n + 1 < b.shots.length && u >= b.shots[n + 1].at) n++;
      c = b.shots[n];
      k = Math.pow(span(u, c.at, n + 1 < b.shots.length ? b.shots[n + 1].at : 1), c.ease || 1);   // `ease` above 1 lingers at the start
    }
    var p = v3(c.from).lerp(v3(c.to), k), look = v3(c.look).lerp(v3(c.lookTo || c.look), k);
    look.y -= LOOK_DROP;
    if (camera.aspect < 1) p.sub(look).multiplyScalar(PORTRAIT_PULL).add(look);
    p.x += Math.sin(t * 0.37) * 0.12; p.y += Math.sin(t * 0.53) * 0.08;
    camera.position.copy(p);
    camera.lookAt(look);
  }

  function frame() {
    var dt = Math.min(MAX_DELTA, clock.getDelta());
    if (playing) {
      if (track && trackOk && !track.paused) { if (track.readyState >= 2) T = track.currentTime; }   // a stalled track holds the clock
      else T += dt;
      if (T >= TOTAL) { T = TOTAL - 0.001; pause(); el.replay.focus(); }
    }
    var i = scenes.findIndex(function (s) { return T < s.end; });
    if (i < 0) i = scenes.length - 1;
    if (i !== current) enter(i);
    var sc = scenes[i], u = progress(sc, T - sc.start), b = built[i];
    b.update(u, T);
    placeCamera(b, u, T);
    var edge = Math.min((T - sc.start) / FADE_SECONDS, (sc.end - T) / FADE_SECONDS, 1);
    if (i === scenes.length - 1) edge = Math.min((T - sc.start) / FADE_SECONDS, 1);
    el.fade.style.opacity = String(1 - clamp01(edge));
    el.lower.classList.toggle("out", (u > TITLE_OUT && i !== scenes.length - 1) || u < TITLE_IN);
    if (b.counter) {
      var k = smooth(span(u, b.counter.from, b.counter.until));
      el.stat.textContent = fmtInt(b.counter.to * k) + b.counter.unit;
    }
    el.seek.value = String(T);
    el.time.textContent = fmtTime(T) + " / " + fmtTime(TOTAL);
    showCaption(T);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  function play() {
    playing = true;
    el.film.classList.add("playing");
    el.play.setAttribute("aria-label", tx("pause", "Pause"));
    el.play.setAttribute("aria-pressed", "true");
    el.playIcon.setAttribute("href", "#i-pause");
    el.poster.hidden = true;
    clock.getDelta();
    trackPlay();
    touch();
  }
  function pause() {
    playing = false;
    el.film.classList.remove("playing", "idle");
    el.play.setAttribute("aria-label", tx("play", "Play"));
    el.play.setAttribute("aria-pressed", "false");
    el.playIcon.setAttribute("href", "#i-play");
    trackPause();
  }
  function seek(t) {
    T = Math.max(0, Math.min(TOTAL - 0.001, t));
    trackSeek(T);
    if (T < TOTAL - 1 && !playing && el.replay) el.replay.blur();
  }
  function restart() { seek(0); play(); }
  function touch() {
    lastInput = Date.now();
    el.film.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { if (playing) el.film.classList.add("idle"); }, IDLE_MS);
  }

  /* ---------- the track: the voiceover and the score, embedded by the builder; it is the clock while it plays ---------- */
  var track = document.getElementById("track");
  var trackOk = !!track;
  /** The track cannot play (decode error or a refused play()): the film runs on its own clock and the button says so. */
  function trackFailed() {
    trackOk = false;
    el.sound.querySelector("span").textContent = tx("noSound", "No sound");
    el.sound.disabled = true;
  }
  if (track) {
    track.addEventListener("error", trackFailed);
    track.addEventListener("ended", function () { if (playing) { T = TOTAL - 0.001; pause(); el.replay.focus(); } });
  }
  /** Start the track at the trailer clock (a click gesture precedes every play, so the browser allows audible playback). */
  function trackPlay() {
    if (!track || !trackOk) return;
    if (Math.abs(track.currentTime - T) > SYNC_TOLERANCE) track.currentTime = T;
    var p = track.play();
    if (p && p.catch) p.catch(trackFailed);
  }
  function trackPause() { if (track) track.pause(); }
  function trackSeek(t) { if (track && trackOk) track.currentTime = t; }
  function toggleMute() {
    if (!track) return;
    track.muted = !track.muted;
    el.sound.setAttribute("aria-pressed", String(!track.muted));
    el.sound.querySelector("span").textContent = track.muted ? tx("muted", "Muted") : tx("soundOn", "Sound on");
  }

  /* ---------- captions: the spoken phrases as text, in time with the voice ---------- */
  var captions = data.captions || [], captionsOn = true, captionShown = -2;
  var CAPTION_HOLD = 0.25;            // seconds a caption stays after its phrase ends
  /** Show the phrase being spoken at film time `t`, or nothing; the page is only touched when the phrase changes. */
  function showCaption(t) {
    var now = -1;
    if (captionsOn) {
      for (var i = 0; i < captions.length; i++) {
        if (t >= captions[i].t && t < captions[i].t + captions[i].d + CAPTION_HOLD) { now = i; break; }
      }
    }
    if (now === captionShown) return;
    captionShown = now;
    el.caption.hidden = now < 0;
    if (now >= 0) el.caption.textContent = captions[now].text;
  }
  function toggleCaptions() {
    captionsOn = !captionsOn;
    el.cc.setAttribute("aria-pressed", String(captionsOn));
  }

  /* ---------- controls ---------- */
  scenes.forEach(function (sc, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chapter";
    b.style.left = (sc.start / TOTAL * 100) + "%";
    b.style.width = (sc.dur / TOTAL * 100) + "%";
    b.style.setProperty("--c", sc.colour);
    b.setAttribute("aria-label", sc.kicker + ": " + sc.title);
    b.title = sc.kicker;
    b.addEventListener("click", function () { seek(sc.start); if (!playing) play(); });
    el.chapters.appendChild(b);
  });
  el.seek.max = String(TOTAL);
  el.play.addEventListener("click", function () { if (playing) pause(); else play(); });
  el.restart.addEventListener("click", restart);
  el.replay.addEventListener("click", restart);
  el.posterPlay.addEventListener("click", play);
  el.seek.addEventListener("input", function () { seek(parseFloat(el.seek.value)); touch(); });
  el.sound.addEventListener("click", toggleMute);
  el.cc.addEventListener("click", toggleCaptions);
  el.full.addEventListener("click", function () {
    var d = document;
    if (d.fullscreenElement) { d.exitFullscreen(); return; }
    if (el.film.requestFullscreen) el.film.requestFullscreen().catch(function () {});
  });
  document.addEventListener("keydown", function (e) {
    if (e.target && /INPUT|BUTTON|A/.test(e.target.tagName) && !/^( |m|c|f|Escape)$/.test(e.key)) return;
    var i = Math.max(0, current);
    if (e.key === " " || e.key === "k") { e.preventDefault(); if (playing) pause(); else play(); }
    else if (e.key === "ArrowRight" || e.key === "l") { seek(scenes[Math.min(scenes.length - 1, i + 1)].start); }
    else if (e.key === "ArrowLeft" || e.key === "j") { seek(T - scenes[i].start > 1.5 ? scenes[i].start : scenes[Math.max(0, i - 1)].start); }
    else if (e.key === "Home") { seek(0); }
    else if (e.key === "m") { toggleMute(); }
    else if (e.key === "c") { toggleCaptions(); }
    else if (e.key === "f") { el.full.click(); }
    touch();
  });
  ["pointermove", "pointerdown", "touchstart", "focusin"].forEach(function (ev) { el.film.addEventListener(ev, touch, { passive: true }); });
  document.addEventListener("visibilitychange", function () { if (document.hidden && playing) pause(); });

  /* ---------- start ---------- */
  resize();
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** A scene's story progress (0 to 1) `seconds` after its cut. A scene with a `warp` moves through its story at a changing
      pace: the warp is a list of [progress, seconds] pairs, and progress is read off between the two that bracket now. */
  function progress(sc, seconds) {
    var w = sc.warp;
    if (!w) return seconds / sc.dur;
    var n = 0;
    while (n + 2 < w.length && seconds >= w[n + 1][1]) n++;
    return lerp(w[n][0], w[n + 1][0], span(seconds, w[n][1], w[n + 1][1]));
  }
  /** Draw scene i, as it looks at progress u, into a still's canvas: a real frame of this film, for a screen inside the film.
      The camera is given the still's 16:9 shape for the shot, so the copy is not stretched. */
  function still(i, u, target) {
    if (i < 0) return;
    var sc = scenes[i], b = built[i], t = sc.start + u * sc.dur;
    enter(i);
    b.update(u, t);
    camera.aspect = target.canvas.width / target.canvas.height;
    camera.updateProjectionMatrix();
    placeCamera(b, u, t);
    renderer.render(scene, camera);
    target.canvas.getContext("2d").drawImage(renderer.domElement, 0, 0, target.canvas.width, target.canvas.height);
    target.map.needsUpdate = true;
  }
  function begin() {
    scenes.forEach(function (s, i) { ensure(i); });
    built.forEach(function (b) {
      if (b.stills) b.stills.forEach(function (st) { still(scenes.findIndex(function (s) { return s.id === st.id; }), st.u, st); });
    });
    resize();
    enter(0);
    document.body.classList.add("ready");
    // a small handle for tools that drive the film from outside (make_video.js sets the clock frame by frame)
    window.__film = { seek: seek, total: TOTAL };
    // #t=42 opens the film paused at 42 seconds; adding &still hides the player, for capturing a clean frame
    var jump = /[#&]t=([\d.]+)/.exec(location.hash);
    if (jump) {
      el.poster.hidden = true;
      seek(parseFloat(jump[1]));
      if (/[#&]still\b/.test(location.hash)) document.body.classList.add("still");
    }
    if (reduced) document.getElementById("poster-note").textContent = tx("reducedMotion", "Your system asks for reduced motion, so the trailer waits for you. It is a moving 3D piece with cuts every few seconds.");
    pause();
    requestAnimationFrame(frame);
  }
  var started = false;
  function once() { if (!started) { started = true; begin(); } }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(once);
  setTimeout(once, FONT_WAIT_MS);
})();
