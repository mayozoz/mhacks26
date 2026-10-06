_This is a submission for the [MLH x DEV Writing Challenge](https://dev.to/mlh-hackathon)_

## What I Built

**Doodle FFA** is a same-room party battle royale for 2–12 players where **you draw your own weapon**.

Everyone joins from their phone by scanning a QR code on a shared screen (a TV, projector or laptop). Then a round goes like this:

1. **Draw (20 s):** sketch any weapon on your phone. A sword, a banana, a squiggle, a flower.
2. **Drop:** roll a random special ability (20 of them, from Dash and Freeze to Nukes) and pick where you land.
3. **Reveal:** the big screen shows off every weapon. Your doodle gets an "upgrade" moment where it turns into finished game art, and an AI commentator announces its name.
4. **Battle (60 s):** your phone becomes a controller (joystick, attack, special) while the fight plays out on the big screen. The storm closes in, and sudden death hits at the end.
5. **Results:** a top-3 podium, then back to the lobby for another round.

**The idea:** we wanted the magic of "draw anything and it just works" without the game ever feeling like an AI demo. Our design rule was the **"invisible middle"**: players never see the words AI, generating, spinners or stats. You draw, and a few seconds later your doodle is a real weapon with its own attack style, projectile behavior, effects and sound.

**Fair under the hood:** the AI only picks *flavor* from fixed building blocks: 8 attack archetypes (swing, thrust, slam, shoot, throw, whip, spin, beam), projectile behaviors (pierce, bounce, split, homing, arc) and decorations. A server-side balance formula then sets the real numbers so every weapon deals the same damage per second. A huge slow hammer and a fast little dagger are equally viable, and nothing you draw can break the game.

**A round never stalls:** every AI step has an instant fallback. If the weapon design is slow, the server builds a weapon from the drawing's *shape* (length, curviness, colors). If the art fails, you fight with your own doodle. If the sound fails, a stock sound plays. The game never waits on an API.

**What we learned:**
- Real-time multiplayer is mostly about edge cases: phones locking mid-round, the big screen reloading, players reconnecting. We ended up treating the server as the single source of truth, and every device just renders what it's told.
- "Make the AI output safe" really means "never trust the AI output". Strict JSON schemas plus a validator that clamps every number got us further than any prompt tweak.
- Phones are hard: pinch-zoom mid-fight, audio that only plays after a tap, and iPhones that can't vibrate from a web page.

**Stack:** TypeScript end to end (pnpm monorepo), PixiJS v8 and three.js on the client, and SpacetimeDB as both the database and the game server, running the battle simulation at 20 ticks per second. The website is hosted on AWS (S3 + CloudFront) at a `.tech` domain.

## Demo

- 🎮 **Play it:** [doodleffa.tech](https://doodleffa.tech). Open it on a laptop or TV, then scan the QR code with 2+ phones.
- 💻 **Code:** [github.com/mayozoz/mhacks26](https://github.com/mayozoz/mhacks26)
- 🎥 **Video:** [https://www.youtube.com/watch?v=B1xxp1ZwI_0](https://www.youtube.com/watch?v=B1xxp1ZwI_0)

## Partner Technologies

### ElevenLabs: the voice of the arena (🏆 our ElevenLabs track win)
ElevenLabs makes the game feel like a live game show:
- **Text-to-speech** (`eleven_flash_v2_5`) voices a sports-style commentator on the big screen, reads each weapon's name during the Reveal ("Maya's Thunder Noodle!"), and has each phone announce "Your weapon is…" to its own player.
- **Sound effects:** every weapon gets a custom one-second sound, generated from a sound description written for that specific weapon.
- **Music:** the title-menu loop was generated ahead of time.

We kept costs predictable with a per-round line budget and a minimum gap between lines. The weapon-name intros skip the LLM entirely, so they're instant.

### xAI (Grok Imagine): doodle → weapon art
The Reveal "upgrade" uses xAI's image model (`grok-imagine-image`) for **image-to-image** editing, paid for with the MHacks xAI API credit. The game server sends the player's raw doodle with a prompt to keep its silhouette, position and colors, and return a finished, cel-shaded game sprite on a pure white background. The client cuts out the white background, so the art drops straight into the arena, the phone's weapon card and the podium.

In our tests it took about 8 seconds and $0.02 per weapon, and returned a roughly 100 KB image. That's small enough to send through the game server directly, with no separate file storage. The call starts the moment a player submits their drawing, so the art is usually ready by the time Reveal begins, and if it isn't, the player's own doodle is used. Everything runs server-side, so the API key never touches a browser.

Getting here took a few tries: we also tested Amazon Bedrock and Google's Gemini image model ("Nano Banana"), and a Gemini version of the game lives in [a separate repo](https://github.com/mayozoz/DoodleFFA). Because the art step sits behind one small, provider-agnostic function, each switch was a single-file change.

### .TECH domain
The game lives at **doodleffa.tech**: a short, memorable link that people type or scan in a crowded room, and one that fits on a QR code under the lobby's big room code.

### Fetch.ai (ASI:One + uAgents)
The `asi1` vision model turns each doodle into a weapon spec (strict JSON schema), and `asi1-mini` writes the commentator's lines. We also wrapped the weapon designer as a Fetch.ai uAgent ("Weapon Smith") that the game can call instead, and that also takes text requests over Fetch.ai's chat protocol.

### SpacetimeDB
The whole game server is a SpacetimeDB module: rooms, the 20 Hz battle simulation, real-time sync to every phone and the big screen, and server-side AI calls with keys in a private table. No separate backend, sockets or sync code.

### AWS
S3 + CloudFront + ACM + Route 53 host the static site with HTTPS on the custom domain.

## Hackathon Experience

We built Doodle FFA at **MHacks 2026** in Ann Arbor, as a team of three, and **we won the ElevenLabs track** from MLH!

I had a lot of confidence in this idea from the start. The more it came together, the more invested I got. Every time a new piece clicked into place, like the first doodle turning into a working weapon or the first round, I thought "damn, this is cool asf".

The **slime-making event** was one of my favorite parts of the weekend: a much needed break that let me reset before diving back in.

The part I'll remember most happened before the awards. During demos, hackers we'd never met kept coming up to our table asking to play. I've always wanted to make something people actually care about, and watching strangers choose to play our game was exactly that feeling. Unfortunately there was no network in the basement so that was a bit dissapointing that we could not have everyone play our game.

Then a Major League Hacking judge saw real value in the idea. For the first time, something I built mattered to other people, and someone vouched for it, so that made me super happy!

I couldn't be at most of the awards ceremony because it coincided with my dance performance, and honestly, all weekend I felt like I needed two more clones of myself to be everywhere I wanted to be. But I'm walking away with a game I'm proud of, a live site at [doodleffa.tech](https://doodleffa.tech), and proof to myself that I can take an idea all the way from a sketch to something people line up to play. Can't wait to take this to the next stage as well!