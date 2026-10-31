# Status line library review

**Library:** `content/status-lines.json` (v1)
**Size:** 1,058 lines (315 high, 316 mid, 315 low, 112 fallback) across 7 packs
**Status:** awaiting human sign-off. Required before launch.

Automated checks (`LIBRARY_FULL=1 npx vitest run tests/content`) already enforce:
- ≤100 characters
- no digits or `%`
- no blocklisted words (`content/blocklist.txt`)
- no near-duplicates
- every pack covers every band
- all emojis valid

## Reviewer checklist

- [ ] Tone is quirky and Gen Z, but kind. Nothing mean, sarcastic about colleagues, or passive-aggressive.
- [ ] Workplace-safe: no innuendo, swearing, alcohol, or anything you wouldn't want a VP or a new hire to read.
- [ ] Nothing medical or about bodies. **Low** lines read as "be gentle / async please", never "I'm unwell".
- [ ] Nothing that reads like a score, rank or percentage.
- [ ] Lines make sense with any emoji from their band's pool.
- [ ] Remove or rewrite anything that falls flat. Delete the line from the JSON; ids don't need to be contiguous.

To pull a fresh random sample: `npx tsx scripts/sample-lines.ts 20`

## Sample (20 random lines per band)

### high (315 lines)

- :sparkles: rare loot mood  _(gaming)_
- :sparkles: speedrunning my inbox  _(gaming)_
- :sparkles: it's giving productive  _(main-character)_
- :sparkles: on a winning streak, queue me up  _(gaming)_
- :sparkles: bright spells all afternoon  _(weather)_
- :sparkles: high voltage goblin  _(chaotic-good)_
- :sparkles: thriving, ask me anything  _(main-character)_
- :sparkles: critical hit on my task list  _(gaming)_
- :sparkles: opening night energy  _(main-character)_
- :doughnut: glazed donut glow  _(snacks)_
- :sparkles: compiled without warnings  _(tech)_
- :sparkles: sunrise energy, early replies  _(weather)_
- :sparkles: combo streak unlocked  _(gaming)_
- :sparkles: glowing and approachable  _(soft)_
- :sparkles: confidence fully loaded  _(main-character)_
- :sparkles: toasted to perfection, ask away  _(snacks)_
- :sparkles: windchill zero, warmth max  _(weather)_
- :sparkles: extra shot of enthusiasm  _(snacks)_
- :sparkles: clear skies, cleared inbox  _(weather)_
- :sparkles: jelly bean joy  _(snacks)_

### mid (316 lines)

- :melting_face: read-only mode for big asks  _(tech)_
- :melting_face: calm protagonist, quiet episode  _(main-character)_
- :melting_face: slow-burn productivity  _(main-character)_
- :melting_face: polite applause energy  _(main-character)_
- :melting_face: crafting something, brb-ish  _(gaming)_
- :melting_face: coasting with grace  _(main-character)_
- :melting_face: present but not performing  _(main-character)_
- :melting_face: storyline: functioning  _(main-character)_
- :melting_face: inventory full, sorting things  _(gaming)_
- :melting_face: cozy subplot energy  _(main-character)_
- :melting_face: exploring the map slowly  _(gaming)_
- :melting_face: mild mystery energy  _(main-character)_
- :melting_face: taking it scene by scene  _(main-character)_
- :melting_face: side quest energy today  _(main-character)_
- :melting_face: in my maintenance era  _(main-character)_
- :melting_face: in-between seasons  _(weather)_
- :melting_face: vibing in the gray area  _(chaotic-good)_
- :melting_face: wandering the overworld  _(gaming)_
- :melting_face: neutral face, kind heart  _(main-character)_
- :melting_face: blanket on, notifications on  _(soft)_

### low (315 lines)

- :battery: observing from the extras' corner  _(main-character)_
- :battery: fog machine is on  _(weather)_
- :battery: in my do-not-disturb arc  _(main-character)_
- :battery: out of mana today  _(gaming)_
- :battery: recharging the stamina bar  _(gaming)_
- :battery: lights low, kindness high  _(main-character)_
- :battery: resting at the inn  _(gaming)_
- :battery: soft reboot underway  _(main-character)_
- :battery: set dressing mode  _(main-character)_
- :battery: afk-ish, back later  _(gaming)_
- :battery: saving my lines for tomorrow  _(main-character)_
- :battery: cozy flashback episode  _(main-character)_
- :battery: quiet stream, no chat please  _(gaming)_
- :battery: cloudy with a chance of naps  _(weather)_
- :battery: frozen in time, thawing soon  _(gaming)_
- :battery: winter mode, minimal outings  _(weather)_
- :battery: checkpoint nap  _(gaming)_
- :battery: in the pause menu of life  _(gaming)_
- :battery: crumbs only today  _(snacks)_
- :battery: hiding behind cover  _(gaming)_

### fallback (112 lines)

- :shrug: the goblins are voting  _(chaotic-good)_
- :shrug: plot twist pending  _(main-character)_
- :shrug: consulting the magic eight ball  _(chaotic-good)_
- :shrug: audition results pending  _(main-character)_
- :shrug: boot sequence in progress  _(gaming)_
- :shrug: scene still being written  _(main-character)_
- :shrug: waiting in the queue  _(gaming)_
- :shrug: script still loading  _(main-character)_
- :shrug: still waking up the vibes  _(soft)_
- :shrug: premiere date unknown  _(main-character)_
- :shrug: press start to continue  _(gaming)_
- :shrug: rolling the dice  _(gaming)_
- :shrug: rehearsing my vibe  _(main-character)_
- :shrug: vibe pending  _(chaotic-good)_
- :shrug: status not found, retrying  _(tech)_
- :shrug: shuffling the deck  _(gaming)_
- :shrug: meteorologist on break  _(weather)_
- :shrug: waiting on the morning report  _(weather)_
- :shrug: waiting for the trailer drop  _(main-character)_
- :shrug: forecast in progress  _(weather)_

## Sign-off

Reviewed by: ______________________  Date: ____________
