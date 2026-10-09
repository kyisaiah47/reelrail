# Changelog

## 0.2.0

- `reelrail doctor` checks Node.js, ffmpeg (with libx264), ffprobe, Python, Pillow and edge-tts, and prints the install command for macOS, Linux and Windows. It exits 1 when a required dependency is missing.
- `reelrail init [dir]` copies the worked example into a folder you own and makes its sample media there. A dry slot now runs straight after `npm install -g reelrail`, with no clone.
- `reelrail run` refuses to run the example copy shipped inside the installed package, because the run would write into `node_modules`. It points to `reelrail init`.
- `reelrail run` reports a publication with no footage source once, before the first draft, with the fix. Before, every draft failed on the same missing footage until the subject pool ran out.
- The README opens with a five-minute quickstart, and the Python install advice uses a virtual environment.
- The worked example's `laneId` and `registryId` are neutral example values.

## 0.1.1

- First public release.
