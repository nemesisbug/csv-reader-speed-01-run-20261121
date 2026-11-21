// csv-reader-speed: the program the harness runs (`node /bot/main.ts`, node22). It reads every case
// from /input/cases.json (a JSON array of {id, input}), answers each one alone with run() from
// solve.js, and writes /output/answers.json: a JSON array of the answers, one per case and in the
// cases' order. Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input
// and /output. Based on the house baseline's driver (csv-reader 1.0.0), with one change: the
// answers are serialized one case at a time instead of one JSON.stringify over the whole array —
// measurably faster on an 11 MB answer array (~99 ms vs ~135 ms on the practice set) and
// byte-identical, since stringifying an array is exactly its elements stringified, joined by commas.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of its work runs under it (the rules: the house
// baseline runs with --no-incremental-marking, and an entry may tune V8's flags too).
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const answers: unknown[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) answers[i] = run(cases[i]!.input);
const parts: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) parts[i] = JSON.stringify(answers[i]);
writeFileSync(join(OUTPUT_DIR, 'answers.json'), `[${parts.join(',')}]`);
