# Full-suite flake — investigated, not yet fixed

**Rate:** ~2 runs in 12 (17%) of `npx jest --runInBand` across all projects.
**Impact:** CI red on a clean tree, roughly one push in six.

## What it looks like

One to three tests fail in a run that is otherwise identical to a passing one.
The victim changes every time and spans unrelated services:

| Run | Victim |
|---|---|
| a | `payroll :: GR-14 POST ack with no payment records returns 400` — got **401** |
| b | `performance :: F2 creates a TEXT question` — expected 201, got **401** |
| c | `benefits :: FW-21 409 insufficient balance` |
| d | `attendance :: OA-01 standard OT → 201` |
| e | `performance :: BC-06 PUT bell-curve-config 400 on missing bands` |

Each victim passes in isolation — six consecutive runs of the three worst
offenders on their own were clean. It only appears in the full sequential run.

## What has been ruled out

**Un-awaited background work — FIXED, but not the cause.**
`payroll.routes.js` called `fireAndForget()` for the publish notification
fan-out and orphaned the promise, so it ran on past the end of the test. Jest
tore the module down underneath it, producing `Cannot log after tests are done`.
Now retained and drained via `drainBackgroundWork()` in `jest.setup.js`. This
removed every such warning — but measurably did **not** change the flake rate.

**Unconsumed `…Once` mock queues — DISPROVED, and the "fix" made it worse.**
The standing hypothesis was that `jest.clearAllMocks()` does not drain queued
`mockResolvedValueOnce` implementations, so a leftover shifts every later
response by one — which fits the 401-where-400 signature exactly. 37 suites
combine `…Once` with `clearAllMocks`.

Switching the 24 suites where it was safe to `jest.resetAllMocks()` was measured
against the unchanged tree:

| Variant | Flake rate |
|---|---|
| `resetAllMocks` in 24 suites | **6 / 12 runs** |
| unchanged (`clearAllMocks`) | **2 / 12 runs** |

Three times worse, so it was reverted. The hypothesis is wrong, or at least
incomplete — and the intuitive fix is actively harmful. Do not retry it without
measuring.

## What is still open

The 401 signature is the strongest clue: several victims fail auth when their
own file's auth mock always calls `next()` and cannot itself produce a 401. That
points at something outside the test file — Jest's per-file sandbox is supposed
to make cross-file mock leakage impossible, so the shared state is likelier to
be `process.env`, a real timer, or an open handle surviving teardown.

Suggested next step: run with `--detectOpenHandles`, and bisect by running the
project list in a fixed order with one project removed at a time.

## Ground rules for whoever picks this up

- **Measure before and after.** 12 runs minimum; the rate is ~17%, so 5 runs
  cannot tell a fix from luck. This is how the `resetAllMocks` regression was
  caught, and it would have shipped otherwise.
- Do not "fix" it by retrying failed tests. That hides a real ordering bug.
