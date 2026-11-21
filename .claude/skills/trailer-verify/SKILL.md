---
name: trailer-verify
description: Check the built film in a real browser: that it loads without errors, that each scene looks right at each camera shot, and that words land on their pictures. Use after every build and before telling the author anything is done.
---

> **Author:** Muhammad Akhtar Shamim · **Licence:** CC BY 4.0 (see LICENSE-MEDIA.md) · **Created:** 2026-11-21
>
> **What this file is:** A skill: how to check the built film in a browser, shot by shot, and how to report honestly what was and was not checked.

# Verify the film

Looking at the page is the only proof. A clean build proves nothing about the picture.

## 1. Open it

Serve the `docs/` folder and open it in a browser:

```bash
python3 -m http.server 8766 --directory docs
```

Then visit `http://localhost:8766/`. Opening `docs/index.html` directly from disk also works.

## 2. Jump to a moment

- In the player: click a chapter on the coloured bar, or press the left and right arrow keys.
- By address: `index.html#t=42` opens paused at 42 seconds. Adding `&still` hides the player for a clean frame:
  `index.html#t=42&still`.
- From the browser console, to step through one scene:

```js
var s = document.getElementById("seek");
s.value = "42.5";
s.dispatchEvent(new Event("input"));
```

## 3. What to check, scene by scene

For **every shot** of every scene that changed:

- Is the subject in frame, in focus of attention, and not hidden behind a head, a lamp or the titles?
- Can every screen and label be read? Do labels overlap each other?
- Do hands, held objects and furniture touch where they should, without passing through each other?
- Is anyone's face bleached or lost in the dark?
- Did anything jump, appear or vanish compared with the shot before?

## 4. Words on pictures

Open `scenes.json`, add each scene's start time to its `cues`, and look at the frame at two or three of those
moments. The picture at that instant must be the thing being named.

## 5. Errors and sound

- The browser console must be empty of errors after a full pass.
- Press Play once with a real click and confirm the sound runs (browsers block sound without a click).
- `audio/audio_facts.json` must say `"all_fit": true`.

## 6. Report honestly

Say which scenes and shots you looked at, and which you did not. "Built" is not "checked".
