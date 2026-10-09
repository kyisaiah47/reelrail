# ReelRail

ReelRail is an open-source agent that makes short narrated videos for a publication. Each run selects a subject, fetches its source, writes a script from that source, renders the video, stores the entry and publishes it. One JSON config describes one publication.

## Quickstart (about five minutes)

```sh
npm install -g reelrail
reelrail doctor                                # checks ffmpeg, ffprobe, Python, Pillow and edge-tts
reelrail init my-first-reel                    # copies the worked example and makes its sample media
reelrail run my-first-reel --slot --dry        # renders one video and posts it nowhere
reelrail --status my-first-reel
```

The video is written to `my-first-reel/out/<slot>/<slot>.mp4`. The dry run needs no model key and no footage key. It writes with the stub writer, narrates with free edge-tts voices, uses the sample clip that `init` made, and records a receipt instead of uploading anything.

If `reelrail doctor` reports a missing dependency, it prints the install command for your system. The usual gap is Python's Pillow and edge-tts packages. Homebrew and Debian Python refuse a global `pip install`, so doctor suggests a virtual environment and tells ReelRail to use it with `REELRAIL_PYTHON`.

Next steps:

- Edit `my-first-reel/subjects.json` and `voice.md` to set the subjects and voice for your publication.
- Set a free `GEMINI_API_KEY` and change `writer` to `{ "provider": "gemini", "model": "gemini-2.5-flash" }` for real scripts.
- Set a free `PEXELS_API_KEY` or `PIXABAY_API_KEY` for real stock footage.

## What makes it ReelRail

**Researched and source-checked scripts.** The research station fetches the subject's Wikipedia article when the clip is written. The writer may use only that text for facts. The writer returns each factual line with its source sentence. A mechanical check rejects the draft when a quoted sentence is absent from the source, when a year or percentage in the clip is absent from the source, or when the source lacks the name the clip uses. Each stored entry keeps the article URL, revision id and quotes.

**Station envelopes.** A slot runs seven stations in order: source, research, write, illustrate, store, publish and distribute. Each station checks its input against a schema and returns `{ ok: true, data, meta }` or `{ ok: false, code, message }`. Only `platform_signal` ends a slot. Every other failure applies to one draft, and the slot writes a fresh draft. ReelRail keeps the last envelope from every station, and `reelrail --status` prints them.

**Render read-back.** After rendering, ReelRail opens the finished mp4 and measures it. The checks confirm that every frame decodes, that the video uses h264 at the planned size and frame rate, that an audio stream exists, that the length matches the plan within 0.35 seconds, that the mix is not silent, that the picture is not black, and that the mid-roll card appears in its window. ReelRail does not store or post a file that fails any check.

**Bring your own model.** One provider interface supports OpenAI, Anthropic, Gemini and any OpenAI-compatible base URL, including a model on your own machine. A `command` provider sends the prompt to any CLI. A `stub` provider writes a valid draft from the research without a network or key for tests and dry runs. Every provider returns JSON only and retries once when the reply does not parse.

## Requirements

Run `reelrail doctor` first. It checks each item below and prints the install command for macOS, Linux and Windows.

- Node.js 22.13 or later.
- ReelRail requires ffmpeg with the libx264 encoder and ffprobe. Set `REELRAIL_FFMPEG` and `REELRAIL_FFPROBE` if they are not on the PATH.
- ReelRail requires Python 3.9 or later with Pillow and edge-tts. Set `REELRAIL_PYTHON` to use a virtual environment's Python.
- You can set your own free Pexels or Pixabay key in `PEXELS_API_KEY` or `PIXABAY_API_KEY` for stock footage. Without a key, ReelRail uses the clips in `illustrate.footage.localDir`.

When you run `npm run example` from a repository clone, the command makes the sample media. It then runs one dry slot of the worked example and writes the video to `examples/whyyourbraindoesthat/out/`.

A video tutorial on YouTube runs the worked example and copies it for a new publication: https://youtu.be/l6DyFQk0F_s

The worked example is in `examples/whyyourbraindoesthat`, and `reelrail init` copies it. The example uses one of our own publications, a series of psychology explainers. When a Pexels or Pixabay key is set, the example uses real stock footage. Without a key, it uses the sample clip. A dry slot fetches the article, writes with the stub writer, renders with edge-tts narration, reads the file back, stores the entry in a local JSON file and writes a receipt instead of uploading it.

## Commands

```sh
reelrail doctor                                    # check system dependencies; exit 1 if one is missing
reelrail init [dir]                                # copy the worked example into dir, with sample media
reelrail run <slug> --slot [--dry]                 # one slot through all seven stations
reelrail run <slug> --station <name> --dry         # one station; prints its envelope
reelrail --status [slug...]                        # last envelope per station, posted and stored counts
reelrail validate <slug>                           # check a config
reelrail clear-halt <slug>                         # resume after you have dealt with a platform signal
reelrail new-app --app console|simple|both         # scaffold a Next.js site that reads the store
```

`<slug>` can identify a config path or a name in `./publications/<slug>.json`, `./<slug>/publication.json` or `./examples/<slug>/publication.json`.

`--slot` without `--dry` runs only during the config's active hours and while the day's count remains below `cadence.perDay`. You can schedule it with cron, launchd or a CI timer.

`--station <name> --dry` stores nothing, posts nothing and leaves the ledger unchanged. The illustrate station still writes its render to `out/` because the read-back opens that file.

The command exits with code 0 when the slot posted or was not due. It exits with code 2 for a usage error or a publication with no footage source, code 3 when a platform signal halted the publication, code 4 when every draft in the run was refused and the slot remains owed, and code 1 for a fault in the engine.

## The publication config

Each publication uses one JSON file. Paths inside that file resolve against the file's own folder.

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

A subject in a `subject-pool` names its article, the term the clip gives, the experience that opens the clip and a footage search.

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

The write station runs these gates on every draft in order. Clip lint checks that narration maps one line to each card and that no hook promises a list the clip does not deliver. The link firewall runs next. The noise and prose lists run next when the config enables them. The claims register runs next when the config names one. The source check runs when a source exists. The do-not-repeat list runs last. A refused draft returns `gate_refused` with every issue, and the next draft's prompt carries those issues.

## Writers

```json
{ "provider": "gemini", "model": "gemini-2.5-flash" }
{ "provider": "openai", "model": "gpt-4.1-mini" }
{ "provider": "anthropic", "model": "claude-sonnet-4-5" }
{ "provider": "openai-compatible", "baseURL": "http://localhost:11434/v1", "model": "llama3.1" }
{ "provider": "command", "command": "llm", "args": ["-m", "gemini-2.5-flash"] }
{ "provider": "stub" }
```

Each provider reads its key from the environment variable named in `apiKeyEnv`. The default variables are `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` and `GEMINI_API_KEY`. A local server needs no key.

## Illustrate

- The footage loader tries Pexels and Pixabay with your own keys in order. When neither provider returns a clip, it uses `illustrate.footage.localDir`. Each clip is used once per publication, and its credit is stored with the entry.
- Narration uses edge-tts in the voice named by the config. `illustrate.tts.pronounce` maps a word to a respelling that the voice says correctly. Captions keep the written word.
- The music bed is a file that you supply in `illustrate.music.file`. The music plays under the voice at `duck` volume and fades in and out.
- Captions use the voice's word timings and contain at most seven words at a time. Each caption moves to the calmest band of the frame beneath it.
- The renderer dissolves several backgrounds into each other. When `illustrate.holdCap` is set, no background runs longer than the cap or loops. The renderer refuses a pool that is too short to cover the read.
- The crop hook cuts stored pictures with `aspect:2:3`, `four-crops`, `none`, or `{ "module": "crop.mjs" }` for your own function. `outputs.store.pictureCrop` sets the default.

## Store

Entries are written in the slot that creates them, never in a later batch. Each row has the shape of a `publication_posts` table and contains publication, slug, n, hook, narration, beats, caption, published, date, ts, taxon, still, wide, gallery, clip_id, permalink, platform, updated_at, sources and meta.

ReelRail writes no machine paths. The ledger, the last slot's data and a dry receipt store paths relative to the config's folder. A JSON or SQLite store stores paths relative to its own file. A Supabase store stores picture URLs and file names.

- `json`: a local file.
- `sqlite` uses a local file through `node:sqlite`. The table is created on first use.
- `supabase` uses the PostgREST and Storage APIs with `SUPABASE_URL` and a service key named by `outputs.store.keyEnv`. Pictures go to the `bucket`.

## Publish

- **YouTube uploads** use the YouTube Data API v3 resumable upload. You supply an OAuth client with the upload scope and a refresh token in `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`. New uploads are private unless you set `outputs.primary.youtube.privacy`.
- **TikTok uploads** use the Content Posting API for a direct post with a file upload. You supply a developer app with the `video.publish` scope and a user token in `TIKTOK_ACCESS_TOKEN`. TikTok permits an unaudited app to post only privately.
- **Browser transport.** The optional browser transport uses a plain Playwright session on a browser profile that you signed into yourself, with selectors that you supply. It runs muted. It stops with a platform signal when the page shows a captcha or sign-in wall. It contains no code that hides automation or changes the browser's fingerprint. Install `playwright-core` to use it.
- **Dry runs.** A dry run writes a receipt with the file's hash and the calls that a real post would make. `--dry` always uses the dry transport.

Before an upload, the YouTube and TikTok transports read the signed-in account and compare it with `outputs.primary.handle`. A mismatch produces a platform signal, and the transport uploads nothing.

**Link handling.** The engine never adds a link. It appends nothing to the caption. It refuses a draft when its hook, narration, cards or caption contains a URL, domain or @handle unless the exact string appears in `links.allow`. The engine checks the caption again immediately before upload.

## Distribute

`outputs.secondary` lists the legs that run from the stored row after the post. Each leg writes an outbox file in `.reelrail/outbox/<leg>/` for your own scheduler or sends a webhook to a URL that you own. A leg that fails after the post is reported and never causes a second post.

## A site for the publication

```sh
npx reelrail new-app --app both --publication whyyourbraindoesthat --dir my-site
cd my-site && cp .env.example .env.local && npm install && npm run dev
```

`--app console` scaffolds one dense view with every entry, the chosen clip, its script and sources, and its read-back measurements. `--app simple` scaffolds one roomy view with the newest clip, what it says, and its sources and checks behind disclosures. `--app both` scaffolds both views, adds a welcome dialog that explains the site and offers the choice, and adds view controls in the footer.

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
