// `reelrail doctor`: checks every system dependency the render needs and prints the install
// command for each missing one on macOS, Linux and Windows. Exit 0 when every required check
// passes, 1 otherwise. Optional checks never fail it.
import { execFileSync } from 'node:child_process';
import { bins } from './render/ffmpeg.js';

const VENV = {
  macos: 'python3 -m venv ~/.reelrail-venv && ~/.reelrail-venv/bin/pip install pillow edge-tts && export REELRAIL_PYTHON=~/.reelrail-venv/bin/python',
  linux: 'python3 -m venv ~/.reelrail-venv && ~/.reelrail-venv/bin/pip install pillow edge-tts && export REELRAIL_PYTHON=~/.reelrail-venv/bin/python',
  windows: 'py -m venv %USERPROFILE%\\.reelrail-venv && %USERPROFILE%\\.reelrail-venv\\Scripts\\pip install pillow edge-tts && setx REELRAIL_PYTHON %USERPROFILE%\\.reelrail-venv\\Scripts\\python.exe',
};
const FFMPEG = { macos: 'brew install ffmpeg', linux: 'sudo apt install ffmpeg   (Fedora: sudo dnf install ffmpeg)', windows: 'winget install Gyan.FFmpeg' };
const PYTHON = { macos: 'brew install python', linux: 'sudo apt install python3 python3-venv', windows: 'winget install Python.Python.3.12' };
const NODE = { macos: 'brew install node   (or nvm install 22)', linux: 'nvm install 22   (https://github.com/nvm-sh/nvm)', windows: 'winget install OpenJS.NodeJS.LTS' };

function out(bin, args) {
  try {
    return { ok: true, text: execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }) };
  } catch (e) {
    return { ok: false, text: String(e.stderr || e.message || '') };
  }
}

const atLeast = (v, min) => {
  const a = v.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < b.length; i++) if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i];
  return true;
};

export function runChecks(env = process.env) {
  const checks = [];
  const add = (name, ok, detail, fix, required = true) => checks.push({ name, ok, detail, fix, required });

  const node = process.versions.node;
  add('Node.js 22.13 or later', atLeast(node, '22.13.0'), `found ${node}`, NODE);

  const ff = out(bins.ffmpeg, ['-hide_banner', '-version']);
  add('ffmpeg', ff.ok, ff.ok ? ff.text.split('\n')[0] : `not found (looked for "${bins.ffmpeg}"; set REELRAIL_FFMPEG to override)`, FFMPEG);
  if (ff.ok) {
    const enc = out(bins.ffmpeg, ['-hide_banner', '-encoders']);
    add('ffmpeg has the libx264 encoder', /libx264/.test(enc.text), /libx264/.test(enc.text) ? 'yes' : 'missing; install a full ffmpeg build', FFMPEG);
  }
  const fp = out(bins.ffprobe, ['-hide_banner', '-version']);
  add('ffprobe', fp.ok, fp.ok ? fp.text.split('\n')[0] : `not found (looked for "${bins.ffprobe}"; it ships with ffmpeg)`, FFMPEG);

  const py = out(bins.python, ['--version']);
  const pyVer = (py.text.match(/Python (\d+\.\d+(\.\d+)?)/) || [])[1];
  add('Python 3.9 or later', py.ok && !!pyVer && atLeast(pyVer, '3.9'), py.ok ? `found ${pyVer || py.text.trim()} at "${bins.python}"` : `not found (looked for "${bins.python}"; set REELRAIL_PYTHON to override)`, PYTHON);
  if (py.ok) {
    const pil = out(bins.python, ['-c', 'import PIL; print(PIL.__version__)']);
    add('Pillow (Python)', pil.ok, pil.ok ? `found ${pil.text.trim()}` : `not importable from "${bins.python}"`, VENV);
    const tts = out(bins.python, ['-c', 'import edge_tts; print(getattr(edge_tts, "__version__", "installed"))']);
    add('edge-tts (Python)', tts.ok, tts.ok ? `found ${tts.text.trim()}` : `not importable from "${bins.python}"`, VENV);
  } else {
    add('Pillow (Python)', false, 'cannot be checked until Python is found', VENV);
    add('edge-tts (Python)', false, 'cannot be checked until Python is found', VENV);
  }

  const footage = ['PEXELS_API_KEY', 'PIXABAY_API_KEY'].filter((k) => env[k]);
  add('stock footage key (optional)', footage.length > 0, footage.length ? `set: ${footage.join(', ')}` : 'none set; the worked example uses its local sample clip instead',
    { all: 'free keys: https://www.pexels.com/api/ or https://pixabay.com/api/docs/, then export PEXELS_API_KEY=...' }, false);
  const model = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'].filter((k) => env[k]);
  add('model key (optional)', model.length > 0, model.length ? `set: ${model.join(', ')}` : 'none set; the stub writer needs no key, and Gemini has a free tier',
    { all: 'a free Gemini key: https://aistudio.google.com/apikey, then export GEMINI_API_KEY=...' }, false);
  return checks;
}

export function formatChecks(checks, platform = process.platform) {
  const os = platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux';
  const lines = [];
  for (const c of checks) {
    lines.push(`${c.ok ? 'ok     ' : c.required ? 'MISSING' : 'note   '} ${c.name}: ${c.detail}`);
    if (!c.ok) {
      const fix = c.fix[os] || c.fix.all;
      if (fix) lines.push(`        fix: ${fix}`);
    }
  }
  const missing = checks.filter((c) => c.required && !c.ok).length;
  lines.push(missing ? `\n${missing} required check(s) failed. Fix them, then run reelrail doctor again.` : '\nEvery required check passed. Next: reelrail init my-first-reel');
  return { text: lines.join('\n'), missing };
}
