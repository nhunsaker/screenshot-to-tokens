# Run outputs behind the numbers

Every number in the video, `README.md` and `docs/SUBMISSION.md` comes from a real run. The full run folders
(screenshots, rewritten sources, reports) live under `out/` and are not committed; these are the summaries
each pipeline stage writes, copied as-is.

| Folder | What | Where it's cited |
|---|---|---|
| `argon/` | Argon Dashboard React, the recording run: `verify.json` (four checks) and `timing.json` | `docs/latency.md`, the video's beats 3–5 |
| `lightbootstrap/` | Light Bootstrap Dashboard: same two files | `docs/dark-mode.md`, `docs/point-and-say.md` |
| `breadth/` | 28 public sites: `summary.json` plus per-site `verify.json` and `timing.json` | `docs/breadth.md`, beat 7 |
| `axe-28/` | axe-core 4.14 comparison per site | `docs/a11y.md`, beat 9 |
| `focus/` | Keyboard-focus probe: Argon (0 of 25 → 25 of 25), div-soup, the control page | `docs/keyboard.md` |
| `point-and-say/` | End-to-end results through the playground page, 3 runs each where required | `docs/point-and-say.md`, beat 6 |

Reproduce any of them with the commands in `docs/SUBMISSION.md` § How to run.
