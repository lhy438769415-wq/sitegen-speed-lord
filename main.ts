// Driver for the sitegen-speed entry: reads every case from
// MAKEFUN_INPUT_DIR/cases.json (default /input), answers each one with run()
// from solve.js, and writes the answers in order to
// MAKEFUN_OUTPUT_DIR/answers.json (default /output). Runs on Node 22, which
// executes this TypeScript file as-is.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Keep V8's incremental marking off for the whole run, as the house baseline
// does, so the timed work runs under the same tuning.
setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

interface Case {
  id: string;
  input: unknown;
}

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as Case[];
const answers: unknown[] = [];
for (const c of cases) {
  answers.push(run(c.input));
}
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
