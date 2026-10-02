// The seven stations, in the order a slot runs them. Each is { name, input, execute }:
// `input` is a schema, and `execute(input, cfg, ctx)` returns an envelope.
import source from './source.js';
import research from './research.js';
import write from './write.js';
import illustrate from './illustrate.js';
import store from './store.js';
import publish from './publish.js';
import distribute from './distribute.js';

export const ORDER = ['source', 'research', 'write', 'illustrate', 'store', 'publish', 'distribute'];
export const STATIONS = { source, research, write, illustrate, store, publish, distribute };
