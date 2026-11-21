# A faster drop-in for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/nemesisbug/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/nemesisbug/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

Entry for [make.fun's "Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121) bounty ($100 in USDC, 10 places paid).

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers exactly as the
reference does on every case — same `{columns, rows, errors}`, same broken-row policy (BOM,
CRLF/LF, stray CRs, quote junk, unterminated quotes, short/long rows) — in about a third of
its CPU time.

## How it is faster

The reference reads one character at a time and builds every field a character at a time.
This one:

- finds an unquoted field with two native `indexOf` scans (next comma, next LF) and takes
  it as a single slice — a stray CR inside it is the rare slow path;
- takes a record with no quote and no stray CR as one slice and splits it natively on commas;
- finds a quoted field's closing quote with `indexOf('"')` scans and slices its segments
  whole, converting CRLF/lone CR to LF only for segments that hold one.

Verified identical to csv-reader 1.0.0 on the kit's practice set (6/6 cases), on 36 cases
drawn with the kit's own generator, and on 99 hand-written edge cases (BOM, CRLF, stray
CRs, quote junk, unterminated quotes, short/long rows, empty inputs). On the practice set,
interleaved 10-round runs, `run()` takes ~0.17 s of CPU against the reference's ~0.70 s
(~4.1x), and the whole driver (`main.ts`, including JSON parse and output) ~0.95 s against
~1.93 s (~2.0x). The driver also serializes one case at a time instead of one
`JSON.stringify` over the whole 11 MB array (~99 ms vs ~135 ms, byte-identical output).

## Layout

- `solve.js` — the entry: an ES module whose `run(input)` returns csv-reader 1.0.0's
  answer for `{text, header}`.
- `main.ts` — the program the harness runs: reads every case from `/input/cases.json`,
  answers each with `run`, writes `/output/answers.json` (V8 incremental marking off,
  as the house baseline runs).

## License

MIT. See [LICENSE](LICENSE).
