#!/usr/bin/env python3
"""One narration line to one mp3, with per-word timings, using edge-tts (free, no key).

  python3 edge_tts_render.py --text "the line" --voice en-US-AriaNeural --rate=-8% --out vo0.mp3 \
      [--pronounce '{"word": "respelling"}']

Beside the mp3 it writes <out>.words.json: one {text, start, end} per spoken word, in seconds,
streamed by edge-tts as WordBoundary events. The renderer cuts the captions from these timings,
so every spoken word is on screen in sync.

`--pronounce` maps a written word to a respelling the voice says correctly. The voice is handed
the respelling and the captions get the written word back.
"""
import argparse
import asyncio
import json
import re

import edge_tts


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--text", required=True)
    p.add_argument("--voice", default="en-US-AriaNeural")
    p.add_argument("--rate", default="-8%")
    p.add_argument("--out", required=True)
    p.add_argument("--pronounce", default="{}")
    a = p.parse_args()

    pron = json.loads(a.pronounce or "{}")
    back = {v.lower(): k for k, v in pron.items()}
    spoken = a.text
    for word, say in pron.items():
        spoken = re.sub(r"\b%s\b" % re.escape(word), say, spoken, flags=re.I)

    comm = edge_tts.Communicate(spoken, a.voice, rate=a.rate, boundary="WordBoundary")
    words = []
    with open(a.out, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 1e7
                t = chunk["text"]
                words.append({
                    "text": back.get(t.lower(), t),
                    "start": round(start, 4),
                    "end": round(start + chunk["duration"] / 1e7, 4),
                })
    with open(re.sub(r"\.mp3$", "", a.out, flags=re.I) + ".words.json", "w") as f:
        json.dump(words, f)
    print(json.dumps({"out": a.out, "words": len(words)}))


asyncio.run(main())
