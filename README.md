# ReelRail

ReelRail is an open-source agent that makes short narrated videos for a publication. Each run picks a subject, fetches its source, writes a script from that source, renders the video, stores the entry and publishes it. One JSON config describes one publication.

## What makes it ReelRail

**Researched and source-checked scripts.** The research station fetches the subject's Wikipedia article when the clip is written, and the writer is given that text as the only place facts may come from. The writer returns every factual line with the source sentence it rests on. A mechanical check then refuses the draft if a quoted sentence is not in the source, if a year or a percentage shown in the clip is not in the source, or if the name the clip gives for something is not in the source. Each stored entry keeps the article URL, its revision id and the quotes.

**A station envelope at every step.** A slot runs seven stations in order: source, research, write, illustrate, store, publish and distribute. Each station checks its input against a schema and returns `{ ok: true, data, meta }` or `{ ok: false, code, message }`. Only `platform_signal` ends a slot. Every other failure is treated as a problem with one draft, and the slot writes a fresh one. The last envelope of every station is kept, and `reelrail --status` prints them.

**The verify read-back.** After the render, ReelRail opens the finished mp4 and measures it. It checks that every frame decodes, that the video is h264 at the planned size and frame rate, that an audio stream is present, that the length matches the plan within 0.35 seconds, that the mix is not silent, that the picture is not black, and that the mid-roll card is on screen in its window. A file that fails any check is not stored or posted.

**Bring your own model.** One provider interface covers OpenAI, Anthropic, Gemini and any OpenAI-compatible base URL, including a model on your own machine. A `command` provider pipes the prompt to any CLI. A `stub` provider writes a valid draft from the research with no network and no key, for tests and dry runs. Every provider returns JSON only, with one retry when the reply does not parse.

## Requirements

- Node.js 22.13 or later.
- ffmpeg and ffprobe on the PATH.
- Python 3 with Pillow and edge-tts: `pip install pillow edge-tts`.
- For stock footage, your own free Pexels or Pixabay API key in `PEXELS_API_KEY` or `PIXABAY_API_KEY`.

## Quick start

```sh
npm install -g reelrail
git clone https://github.com/kyisaiah47/reelrail && cd reelrail
npm run sample-media                                      # a music bed and a sample clip, made with ffmpeg
reelrail run whyyourbraindoesthat --slot --dry            # one full slot, posted to the dry transport
reelrail --status
```

The worked example is in `examples/whyyourbraindoesthat`. It is built from one of our own publications, a series of psychology explainers. With a Pexels or Pixabay key set, it uses real stock footage. Without one, it uses the sample clip. A dry slot fetches the article, writes with the stub writer, renders with edge-tts narration, reads the file back, stores the entry in a local JSON file and writes a receipt in place of the upload.

## Commands

```sh
reelrail run <slug> --slot [--dry]                 # one slot through all seven stations
reelrail run <slug> --station <name> --dry         # one station; prints its envelope
reelrail --status [slug...]                        # last envelope per station, posted and stored counts
reelrail validate <slug>                           # check a config
reelrail clear-halt <slug>                         # resume after you have dealt with a platform signal
reelrail new-app --app console|simple|both         # scaffold a Next.js site that reads the store
```

`<slug>` is a path to a config, or a name found in `./publications/<slug>.json`, `./<slug>/publication.json` or `./examples/<slug>/publication.json`.

`--slot` without `--dry` runs only inside the config's active hours and only while the day's count is under `cadence.perDay`. Schedule it with cron, launchd or a CI timer.

`--station <name> --dry` stores nothing, posts nothing and leaves the ledger as it was. The illustrate station still writes its render to `out/`, because the read-back opens that file.

Exit codes: 0 when the slot posted or was not due, 2 for a usage error, 3 when a platform signal halted the publication, 4 when every draft in the run was refused and the slot is still owed, and 1 for a fault in the engine.

## The publication config

One JSON file per publication. Paths inside it resolve against the file's own folder.

| key | what it holds |
|---|---|
| `slug`, `publication` | the config's name and the publication's name in the store |
| `laneId`, `registryId` | your own identifiers for the lane and its account |
| `host` | the publication's website. ReelRail never adds it to a post. |
| `voiceFile` | the voice rules, handed to the writer on every draft |
| `format` | `kind` (`vertical-narrated` or `landscape-documentary`), `frame` (`1080x1920`), `schema` and `ttsVoice`, the one fixed narration voice |
| `source` | `kind` (`subject-pool` or `footage-query`), the `pool` (inline, a file, or `file.json#key`) and `recent`, how many slots a subject sits out |
| `research` | `kind`: `wikipedia-raw` or `none` |
| `gates` | the optional copy gates: `noise`, `prose`, and `claims:<file>` for a claims register |
| `cadence` | `perDay` and `activeHours` |
| `outputs` | `primary` (`platform`, `handle`, `transport`), `store` (`kind`, `path`, `table`, `bucket`, `pictureCrop`) and `secondary` legs |
| `writer` | the model provider (optional, defaults to `stub`) |
| `illustrate` | footage, narration rate, music bed, captions, crop rule (optional) |
| `links` | `allow`: exact strings the writer may include (optional, empty by default) |

A subject in a `subject-pool` names its article, the term the clip gives, the experience the clip opens on and a footage search:

```json
{ "id": "spotlight-effect", "term": "spotlight effect",
  "article": "https://en.wikipedia.org/wiki/Spotlight_effect",
  "angle": "You walk into a room sure that everyone noticed the mark on your shirt.",
  "query": "soft light curtains" }
```

## The stations

| station | input | output |
|---|---|---|
| source | recent subjects, excluded subjects | `subjectId`, `query`, `sourceUrls`, `subject` |
| research | the subject's source URLs | `sourceText`, `facts`, `citations` |
| write | the subject, the source text, the do-not-repeat list | `draft`: hook, beats, narration, mid-roll card, caption, term, evidence |
| illustrate | the draft and the footage query | `video`, `stills`, `duration`, `verify`, `footage` credits |
| store | the draft, the render and the citations | `entryId` and the stored row |
| publish | the entry and the video | `postId`, `url`, `transport` |
| distribute | the stored row | one record per secondary leg |

The write station runs these gates on every draft, in order. The clip lint checks that narration maps one line to each card and that no hook promises a list the clip does not deliver. The link firewall comes next. Then come the noise and prose lists if the config turns them on, the claims register if the config names one, the source check when there is a source, and the do-not-repeat list. A refused draft returns `gate_refused` with every issue, and the next draft's prompt carries them.

## Writers

```json
{ "provider": "gemini", "model": "gemini-2.5-flash" }
{ "provider": "openai", "model": "gpt-4.1-mini" }
{ "provider": "anthropic", "model": "claude-sonnet-4-5" }
{ "provider": "openai-compatible", "baseURL": "http://localhost:11434/v1", "model": "llama3.1" }
{ "provider": "command", "command": "llm", "args": ["-m", "gemini-2.5-flash"] }
{ "provider": "stub" }
```

Each provider reads its key from the environment variable named in `apiKeyEnv`. The defaults are `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` and `GEMINI_API_KEY`. A local server needs no key.

## Illustrate

- Footage comes from Pexels and Pixabay with your own keys, tried in order, and from `illustrate.footage.localDir` when neither returns a clip. Each clip is used once per publication, and its credit is stored with the entry.
- Narration uses edge-tts in the one voice the config names. `illustrate.tts.pronounce` maps a word to a respelling the voice says correctly; captions keep the written word.
- The music bed is a file you supply in `illustrate.music.file`. It sits under the voice at `duck` volume and fades in and out.
- Captions are cut from the voice's own word timings, at most seven words at a time. Each caption moves to the calmest band of the frame under it.
- Several backgrounds dissolve into each other. With `illustrate.holdCap` set, no background runs longer than the cap or loops, and a pool too short to cover the read is refused.
- The crop hook cuts the stored pictures: `aspect:2:3`, `four-crops`, `none`, or `{ "module": "crop.mjs" }` for your own function. `outputs.store.pictureCrop` sets the default.

## Store

Entries are written in the slot that made them, never in a later batch. The row has the shape of a `publication_posts` table: publication, slug, n, hook, narration, beats, caption, published, date, ts, taxon, still, wide, gallery, clip_id, permalink, platform, updated_at, sources and meta.

- `json`: a local file.
- `sqlite`: a local file through `node:sqlite`. The table is created on first use.
- `supabase`: the PostgREST and Storage APIs, with `SUPABASE_URL` and a service key named by `outputs.store.keyEnv`. Pictures go to the `bucket`.

## Publish

- **YouTube** through the YouTube Data API v3 resumable upload. You supply an OAuth client with the upload scope and a refresh token: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`. New uploads are private unless you set `outputs.primary.youtube.privacy`.
- **TikTok** through the Content Posting API, direct post with a file upload. You supply a developer app with the `video.publish` scope and a user token in `TIKTOK_ACCESS_TOKEN`. TikTok allows an app it has not audited to post only privately.
- **Browser**, optional. A plain Playwright session on a browser profile you signed into yourself, with selectors you supply. It runs muted. It stops with a platform signal when the page shows a captcha or a sign-in wall. It contains no code that hides automation or changes the browser's fingerprint. Install `playwright-core` to use it.
- **Dry**. Writes a receipt with the file's hash and the calls a real post would make. `--dry` always uses it.

Before any upload, the YouTube and TikTok transports read back the signed-in account and compare it with `outputs.primary.handle`. A mismatch is a platform signal and nothing is uploaded.

**The engine never adds a link.** It appends nothing to the caption, and it refuses a draft whose hook, narration, cards or caption carry a URL, a domain or an @handle, unless the exact string is in `links.allow`. The caption is checked again right before the upload.

## Distribute

`outputs.secondary` lists the legs that run from the stored row after the post: an outbox file per leg in `.reelrail/outbox/<leg>/` for your own scheduler, or a webhook to a URL you own. A leg that fails after the post is reported and never causes a second post.

## A site for the publication

```sh
reelrail new-app --app both --publication whyyourbraindoesthat --dir site
cd site && cp .env.example .env.local && npm install && npm run dev
```

`--app console` scaffolds one dense view with every entry, the chosen clip, its script and sources, and its read-back measurements. `--app simple` scaffolds one roomy view with the newest clip, what it says, and its sources and checks behind disclosures. `--app both` gives both, a welcome dialog that explains the site and offers the choice, and view controls in the footer.

## Platform terms

Each platform's terms of service and automation rules apply to whoever runs ReelRail. You run it on your own accounts, with your own developer apps and keys, and you carry the account risk. ReelRail stops when a platform signals a problem with the account, and it does not try to get around a platform's limits. Footage keeps its provider's license (Pexels License, Pixabay Content License). Wikipedia text is CC BY-SA, and each entry stores the article and revision it used. edge-tts calls Microsoft's online speech service, whose terms also apply.

## Development

```sh
npm test               # node:test; render tests need ffmpeg and Pillow, a live writer test needs GEMINI_API_KEY
npm run scrub          # the scrub gate, also run in CI
```

The tests never read a paid model key. The one live model test uses the free Gemini tier and is skipped when `GEMINI_API_KEY` is not set.

## License

MIT. Copyright Compound Labs. Built by [Compound Labs](https://thecompound.tech).
