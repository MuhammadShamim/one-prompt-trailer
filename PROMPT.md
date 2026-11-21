# 🎬 The prompt

> **Author:** Muhammad Akhtar Shamim · **Licence:** CC BY 4.0 (see LICENSE-MEDIA.md) · **Created:** 2026-11-21
>
> **What this file is:** The prompt people paste into an AI coding assistant to start a trailer for their own project, with its copyright rules and the questions the assistant must ask.

Take this prompt and the sample trailer into **your own project**: copy this repository into your project as a
folder named `trailer/`. Then open your project in an AI coding assistant (this was written for and tested with
Claude Code) and paste the prompt below.

It is a starting brief. Expect to give feedback afterwards: the sample film in `docs/index.html` took this brief plus
many rounds of "this scene is too dark", "show the real screen", "these two lines are out of sync". The rules in
`CLAUDE.md` and the skills in `.claude/skills/` exist so those rounds go quickly.

---

```text
You are making a cinematic trailer for my project.

MY PROJECT
It is this repository: the code, documents, slides, spreadsheets and notes around you.
Read it first. Do not invent anything about it, and do not change any of my project's own files.

THE TRAILER KIT
The folder `trailer/` holds a film engine, its rules and a finished sample film (trailer/docs/index.html)
that was built with it. Work only inside `trailer/`. Study the sample to see what "good" looks like,
then replace its scenes with scenes about my project.

WHAT TO MAKE
One self-contained HTML page (trailer/docs/index.html) that plays a 60 to 100 second film:
live 3D scenes drawn in the browser, a spoken voiceover, original music, titles, and a player with chapters.
It must work by double-clicking the file. No server, no installs for the viewer.

HOW THE KIT WORKS (all inside trailer/; read these before changing anything)
- CLAUDE.md                 the rules. They override your defaults.
- scenes.json               the film as data: one entry per scene (words on screen, spoken line, colours, timing).
- src/film.js               the engine: helpers, props and people, one builder per scene, the director, the player.
- score.py, make_audio.py   the music (synthesised in code) and the voice (Kokoro, runs locally).
- tighten.py                squeezes silent gaps so the film is as short as its words allow.
- build.py                  assembles everything into docs/index.html.
- .claude/skills/           step-by-step workflows: trailer-build, trailer-scene, trailer-verify.
- .claude/agents/           reviewers: scene-reviewer, claims-checker.

THE STORY (three acts; adapt it to my project, keep the shape)
1. The problem. Who struggles, and with what, before my project exists? Show a person living it:
   a real place, real objects, something the viewer recognises. Three to five short scenes.
2. How it works. Show my project doing its job, one step per scene. Show the actual screens, files,
   machines or people involved, not symbols for them.
3. The payoff. The same person, the same place, now better. End on credits: what the project is,
   and what this film was made with.

RULES FOR EVERY SCENE
- People and real objects, never abstract shapes. Use person(), pose(), deskSet(), officeRoom(),
  laptopProp(), tag() and the other helpers; write new props in the same style when you need them.
- Several camera angles per scene (`shots`), and something moving in every shot.
- Anything shown on a screen inside the film must be readable and must face the person using it.
- The same person, clothes and objects from one scene to the next. Nothing appears or vanishes on a cut.
- Bright enough to see faces. Check every scene in a browser before you call it done.

RULES FOR EVERY WORD
- Plain words a newcomer understands. No jargon, no slogans.
- Every number on screen or spoken must be counted from my project's files by a script. Never type a number
  from memory. If you cannot count it, do not say it.
- Short spoken phrases, each tied to the picture it belongs to (`beats` in scenes.json).
- Be kind to other professions. If the film compares my project to how things are usually done,
  show those people as skilled, and say what my project is for, not what it replaces.
- No brand or product names on screen unless I own them, except in the closing credits.
- Say that the voice is synthetic and the music is generated.
- Keep the captions, the transcript and the keyboard controls working, and load nothing from any other site.

COPYRIGHT AND PLAGIARISM (these outrank every other instruction here)
- Use only two kinds of material: what is in my project, and what you make new for this film.
- Copy nothing from anyone else: no text, code, pictures, photos, music, sounds, video, fonts, logos,
  characters or designs. That includes the sample film. It shows the level of quality to reach;
  write a new story and new lines for my project, and do not reuse its script.
- Imitate no one: no named artist, song, film, brand style, or a real person's voice or likeness.
- Music stays instrumental and is synthesised here. No samples, no melodies from existing songs.
- A fact or statistic from outside my project needs its source named on screen, or it is left out.
  A quotation needs its author and must be short.
- Before adding any outside library, check its licence allows this use, keep its notice, and add it
  to THIRD-PARTY.md. If you are not sure it is allowed, do not add it; ask me.
- My project may contain things that are not mine to publish: client or employer material, personal
  data, licensed assets, confidential numbers. When you see any, stop and ask before using it.
- Promise nothing legal. Never write "copyright free", "royalty free" or "you own this".
- Keep the notice that the voice is synthetic and the music generated, and keep the kit's LICENSE,
  LICENSE-MEDIA.md and THIRD-PARTY.md.
- At the end, give me a rights list: every picture, sound and text source in the film and where it
  came from. If you cannot say where something came from, remove it.

QUESTIONS TO ASK ME FIRST
After reading my project and before planning, ask me the questions below.
- Ask ONE question at a time and wait for my answer.
- Offer two to four options, put the one you recommend first, and say in one line why you recommend
  it for THIS project. Always allow my own answer as well.
- Skip a question my project already answers, and tell me what you took from it.
- When all are answered, repeat my choices back in a short list and wait for my "go".

 1. Audience. Who must this film win over? (customers, managers, investors, recruiters, the public)
 2. The one thing. What should they remember, and what should they do next? (visit a link,
    get in touch, try it, nothing)
 3. Language. Which language for the words on screen and for the voice? This kit ships in English.
    Before offering a language, check that the voice tool has a voice for it and that the fonts
    cover its script. If it does not, offer: text in my language with no voice, text in my language
    with an English voice, or English. For a right-to-left script, say what else must change.
    Also ask whether I want more than one language version.
 4. What to deliver. The HTML page only; the page and an MP4 video (best for social posts);
    also a poster; also a silent preview for a README.
 5. Length. About 30 seconds (a teaser), 60 seconds, or 90 to 100 seconds (the full story).
 6. Shape. Wide 16:9 (screens and video sites), tall 9:16 (phones), or square. Check each scene still frames
    its subject in the shape I choose.
 7. Tone and voice. Energetic, calm or serious; and which voice from those available.
 8. Look. My project's own colours and name, or choose for me.
 9. Limits. Names, clients, numbers or comparisons that must never appear.
10. Credits. The name to show as author, and the notice at the end.

HOW TO WORK
1. Read my project. Then ask the questions above, one at a time.
2. Write a one-page plan: the audience, the three acts, each scene in one line (what we see, what
   is said). Stop and show me the plan before building.
3. Build one scene at a time with the trailer-scene skill. After each scene, show me a screenshot
   of every shot and wait for my notes.
4. When all scenes exist: run the trailer-build skill (voice, music, tighten, page), then the
   trailer-verify skill, then both reviewer agents. Fix what they find.
5. Make the other things I asked for in question 4 (make_video.js for the video and the preview,
   make_poster.py for the poster).
6. Give me the files, the film's length, the rights list, and an honest list of what you did not check.

Document every file you write the way CLAUDE.md asks. Whenever you are unsure, ask me: one question
at a time, with options and your recommendation.
```

---

## What the prompt makes the assistant do

| Part | In short |
|---|---|
| **Copyright and plagiarism** | Only your project's material or newly made material; nothing copied or imitated, including this repo's sample story; sources for outside facts; a rights list at the end |
| **Questions first** | Ten questions, one at a time, each with options and a recommendation: audience, message, language, what to deliver, length, shape, tone, look, limits, credits |
| **A plan, then one scene at a time** | You approve the plan and every scene before the next is built |
| **Checks** | A build, a look at every shot in a browser, and two reviewers: one for the picture, one for every claim |

> 🌍 **Language:** the sample and the kit are in English. The prompt makes the assistant check, before it offers
> another language, that the voice tool can speak it and the fonts can show it, and tell you plainly when they cannot.

## Tips for the feedback rounds

- **Go scene by scene.** "Let's fix scene 3" gets a better result than a list of twelve notes at once.
- **Send screenshots.** Circle or describe the exact thing that looks wrong.
- **Ask for it shorter last.** Get every scene right first, then run `tighten.py` and cut words.
- **Name your limits.** Tell the assistant what must never be said or shown about your project or your competitors.
