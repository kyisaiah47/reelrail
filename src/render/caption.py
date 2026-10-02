#!/usr/bin/env python3
"""Render caption cues and the mid-roll card to transparent PNGs, in one process.

ffmpeg builds without libfreetype have no drawtext, so text is drawn here with Pillow and
composited by render.js with the overlay filter. Jobs arrive as JSON on stdin:

  {"jobs": [
    {"kind": "caption", "text": "...", "out": "cue0.png", "width": 1080, "height": 1920,
     "font": null, "size": 64, "color": "#FBF6EC", "pos": "center", "avoid": "frame.png"},
    {"kind": "card", "title": "...", "points": ["...", "...", "..."], "out": "card.png",
     "width": 1080, "height": 1920, "font": null, "paper": "#F4EFE6", "ink": "#1E1A16"}
  ]}

`avoid` is a still of the footage the caption will sit over. The caption block slides, within a
band around its nominal position, to the rows with the least edge energy, so text does not land
on the object the line is about. Without it the block sits at its nominal position.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FALLBACK_FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "C:\\Windows\\Fonts\\arialbd.ttf",
]


def load_font(path, size):
    for p in ([path] if path else []) + FALLBACK_FONTS:
        if p and os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def rgba(h):
    h = h.lstrip("#")
    if len(h) == 6:
        h += "FF"
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4, 6))


def wrap(draw, text, font, max_w):
    lines = []
    for para in str(text).split("\n"):
        cur = ""
        for w in para.split():
            trial = (cur + " " + w).strip()
            if draw.textlength(trial, font=font) <= max_w or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = w
        lines.append(cur)
    return [l for l in lines if l]


def quietest_band(frame_path, y_nominal, block_h, height, span=0.18):
    try:
        im = Image.open(frame_path).convert("L")
        if im.height != height:
            im = im.resize((max(1, round(im.width * height / im.height)), height))
        edges = im.filter(ImageFilter.FIND_EDGES)
        px = edges.load()
        w = edges.width
        step = max(1, w // 96)
        acc = [0] * (height + 1)
        for y in range(height):
            acc[y + 1] = acc[y] + sum(px[x, y] for x in range(0, w, step))
        reach = int(height * span)
        lo = max(0, y_nominal - reach)
        hi = min(height - block_h, y_nominal + reach)
        if hi <= lo or block_h <= 0:
            return y_nominal

        def cost(y):
            return acc[min(height, y + block_h)] - acc[max(0, y)]

        best, best_c = y_nominal, cost(max(0, min(height - block_h, y_nominal)))
        for y in range(lo, hi + 1, 4):
            c = cost(y)
            if c < best_c * 0.90:
                best, best_c = y, c
        return best
    except Exception:
        return y_nominal


def caption(job):
    W, H = job.get("width", 1080), job.get("height", 1920)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    size = int(job.get("size") or round(W * 0.06))
    font = load_font(job.get("font"), size)
    pad = int(W * 0.11)
    lines = wrap(draw, job["text"], font, W - 2 * pad)
    line_h = draw.textbbox((0, 0), "Ag", font=font)[3] + int(size * 0.3)
    block_h = line_h * len(lines)
    pos = job.get("pos", "center")
    if pos == "lower":
        y0 = int(H * 0.62)
    elif pos == "upper":
        y0 = int(H * 0.16)
    elif pos == "bottom":
        y0 = H - int(H * 0.08) - block_h
    else:
        y0 = (H - block_h) // 2
    if job.get("avoid"):
        y0 = quietest_band(job["avoid"], y0, block_h, H)
    fill = rgba(job.get("color", "#FBF6EC"))
    stroke = max(2, size // 14)
    # A blurred dark halo under the text keeps it readable over pale footage (fog, sky, a lit wall).
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    y = y0
    for ln in lines:
        x = (W - draw.textlength(ln, font=font)) // 2
        hd.text((x, y + 3), ln, font=font, fill=(0, 0, 0, 210), stroke_width=stroke * 3, stroke_fill=(0, 0, 0, 210))
        y += line_h
    halo = halo.filter(ImageFilter.GaussianBlur(radius=max(6, size // 6)))
    img.alpha_composite(halo)
    y = y0
    for ln in lines:
        x = (W - draw.textlength(ln, font=font)) // 2
        draw.text((x, y), ln, font=font, fill=fill, stroke_width=stroke, stroke_fill=(0, 0, 0, 190))
        y += line_h
    img.save(job["out"])


def card(job):
    W, H = job.get("width", 1080), job.get("height", 1920)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    paper = rgba(job.get("paper", "#F4EFE6"))
    ink = rgba(job.get("ink", "#1E1A16"))
    margin = int(min(W, H) * 0.08)
    box_w = W - 2 * margin
    title_font = load_font(job.get("font"), int(min(W, H) * 0.075))
    point_font = load_font(job.get("font"), int(min(W, H) * 0.048))
    inner = box_w - 2 * int(margin * 0.9)
    title_lines = wrap(draw, job.get("title", ""), title_font, inner)
    point_lines = [wrap(draw, p, point_font, inner - int(margin * 0.6)) for p in job.get("points", [])]
    th = draw.textbbox((0, 0), "Ag", font=title_font)[3]
    ph = draw.textbbox((0, 0), "Ag", font=point_font)[3]
    gap = int(th * 0.6)
    body_h = len(title_lines) * int(th * 1.2) + gap + sum(len(pl) * int(ph * 1.35) + int(ph * 0.6) for pl in point_lines)
    box_h = body_h + 2 * int(margin * 0.9)
    bx0 = margin
    by0 = (H - box_h) // 2
    draw.rounded_rectangle([bx0, by0, bx0 + box_w, by0 + box_h], radius=int(margin * 0.5), fill=paper)
    x = bx0 + int(margin * 0.9)
    y = by0 + int(margin * 0.9)
    for ln in title_lines:
        draw.text((x, y), ln, font=title_font, fill=ink)
        y += int(th * 1.2)
    y += gap
    for i, pl in enumerate(point_lines):
        draw.text((x, y), str(i + 1), font=point_font, fill=ink[:3] + (150,))
        for ln in pl:
            draw.text((x + int(margin * 0.6), y), ln, font=point_font, fill=ink)
            y += int(ph * 1.35)
        y += int(ph * 0.6)
    img.save(job["out"])


def main():
    data = json.load(sys.stdin)
    for job in data.get("jobs", []):
        (card if job.get("kind") == "card" else caption)(job)
    print(json.dumps({"rendered": len(data.get("jobs", []))}))


if __name__ == "__main__":
    main()
