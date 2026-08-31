# Proof Search Session Notes

Running log of what we've tried, learned, and what's next. Pick up exactly where we left off.

## Goal

Prove (or disprove) that the **rank-7 motif** is a forced win for white in Razzle Dazzle. White ball on rank 7 + uncovered adjacent goal-rank files = should be forced according to user's intuition + dojo regression evidence (see `project_forced_win_motif.md` in memory).

## Tooling

- `scripts/proofSearch.js` — iterative deepening alpha-beta with pure terminal eval (no heuristic features). Returns PROVEN_WIN / PROVEN_LOSS / UNDECIDED at each depth.
- Own sharded TT (8 shards, cap configurable). **Not persisted across runs.**
- `caffeinate -dimsu` wrapper required for long runs (laptop sleep would kill the process).

## Calibration data (prodDB)

| Difficulty | Human wins | Median turns | Min | Max |
|---|---|---|---|---|
| easy | 2 | 11 | 9 | 11 |
| medium | 1 | 15 | 15 | 15 |
| hard | 1 | 19 | 19 | 19 |
| impossible | 5 | 15 | 13 | 17 |

**All 5 impossible wins were as white vs black AI.** Confirms user's observation: penultimate-rank strategy works asymmetrically — white-tempo advantage compounds in no-capture games.

## Cost model

EBF (effective branching factor) on current code measured ~3 per depth. Extrapolating from d8 = 50M nodes ≈ 15 min:

| Depth | Nodes | Wall (current code) | Wall (with null-move) |
|---|---|---|---|
| 10 | ~450M | ~6–8 hr | ~2 hr |
| 12 | ~4B | ~30–48 hr | ~8 hr |
| 14 | ~36B | ~10 days | ~2 days |
| 18 | ~3T | ~3 months | ~1 week |
| 20 | ~30T | ~3 years | ~3 weeks |

Memory wall hits around d11-d12 with current TT_SHARD_CAP=3M (24M total). At d14+, cache thrashing dominates.

## What we tried

### Round 1: depth 8 on P1_naked_f7
- Fixture: white ball on f7, black full back rank (ball on e8), white pieces c1/d1/e1, black to defend
- Result: **undecided at d8** (50M nodes, ~15 min effective)
- d9 aborted at 125M nodes in 1hr time budget

### Round 2 postmortem: runner bug found & fixed (2026-06-30)

`runFixture` hardcoded `isMax = true` at the root — only correct when `fixture.sideToMove === fixture.rootColor`. When they differ (root player is NOT the side to move), root should be a MIN node.

P1/P2/P4 & SANITY_two_turn_win had `sideToMove === rootColor` so were unaffected — their d10 results stand.

SANITY_immediate_win had `sideToMove=black, rootColor=white` — hit the bug, returned undecided at d10 (should have been d2). **Fix at proofSearch.js:274 + 277–283** — `isMax = fixture.sideToMove === fixture.rootColor`, root aggregation now handles both max/min. Both sanity fixtures now prove cleanly. Verified 2026-06-30.

**Critical implication for real-game fixtures:** `winFixtures.json` has `rootColor=humanColor=white` and `sideToMove=black` (opposite of last-mover). Same combo as the buggy sanity fixture. Without the fix, all 5 would have returned garbage. Fix is now in place — safe to run.

### Round 2: depth 10 on P1/P2/P4 (2026-06-29 evening, results valid)
- caffeinate-wrapped, 12hr/fixture budget
- SANITY_two_turn_win: **PROVEN WIN in 3 plies at d3+** — sanity check passes, search machinery sound
- P1 at d9: still undecided (139M nodes, completed this time thanks to deeper iterative budget)
- P1 at d10: in progress as of last check
- Memory: RSS ~2.1GB, well under cap

### Round 3: real-win fixtures launched (2026-07-04)

- `proofSearch.js` now stops iterating deeper once a fixture is PROVEN (was burning remaining budget re-proving).
- Dry run at d2 confirmed `--fixtures scripts/winFixtures.json` loads all 5 boards correctly.
- **Launched**: `caffeinate -dimsu node scripts/proofSearch.js --fixtures scripts/winFixtures.json --maxDepth 12 --timeLimitMs 21600000` → `data/selfplay/proof_search_winfixtures_d12.log`
- 6 hr/fixture budget, sequential, worst case ~30 hr. Fixtures are snapshots 6 turns (~12 plies) before the human win, so d10–d12 should reach the end of each game if the win was forced.
- Note: Jun 29–30 round-2 d10 terminal run was never logged to a file; P1 d10 result lost. P1 d9 = undecided at 139M nodes (from notes).

**Round 3 results so far:**
- **REAL_77e1f2_T9of15: PROVEN WIN in 6 plies** (depth 6, 3M nodes, ~minutes) — first mathematical proof that a real-game penultimate position was forced. The impossible AI was dead lost 6 turns before the end with NO defense available. Best line starts `move d6→e4 + pass d4→e4`.
- First launch died ~03:26 when the MacBook slept — `caffeinate -s` only prevents system sleep **on AC power**; laptop was on battery. Lost ~211M nodes of fixture-2 progress (d8 complete, undecided; died in d9). No TT persistence yet, so resume restarts the fixture from scratch.
- Resumed 2026-07-04 morning with `data/selfplay/winFixtures_resume.json` (remaining 4 fixtures), appending to same log. **Machine must stay on AC power for the run to survive.**
- Fixture-2 note: d8 took 211M nodes (vs P1's 50M) — this one is deeper/busier than the synthetic fixtures; may exhaust its 6 hr budget around d9–d10.
- **Two more kills diagnosed (Jul 4):** both resume attempts died during fixture-2 d9 with status "killed" and no crash/jetsam report. Cause: background tasks launched through the Claude Code session die when the session is interrupted (lid-close/sleep events at 03:26 and ~12:00 line up exactly). NOT a memory problem — the identical log endpoint (d8 @ 211M nodes) is just because d9 is a >1 hr silent stretch.
- **Fix:** relaunch fully detached — `nohup caffeinate -dimsu zsh -c 'node --max-old-space-size=10240 scripts/proofSearch.js ...' & disown` → PPID 1, immune to session lifecycle. PID in `data/selfplay/proofsearch.pid`; wrapper echoes node's exit code into the log on any death. Still requires lid-open (battery) or AC power — sleep suspends the process and burns wall-clock budget.

## Key insight (the pivot)

**Proving the motif from a "setup" position is the hard version.** d18–d22 proof depth needed against optimal defender (estimated ~1.3× the empirical 13–17 turn impossible-win length).

**Better approach: compositional proof.** Prove forced wins from positions *closer to delivery*, then chain. Two short proofs > one impossible proof.

Concretely: take the 5 real human-vs-impossible wins, snapshot the board ~6 turns before the end, prove forced win from there. d10–d12 should suffice.

## ✅ STEP 0 — DONE (2026-07-08): full turn grammar shipped

`generateTurnOutcomes` rewritten: `[pass chain] → [move one non-carrier] → [pass chain]`, all stages optional, outcomes deduped by final board hash. Regression tests added (`tests/aiLogic.test.js` → "turn grammar: pass-then-move interleaving") — the a822c5 winning turn is the acceptance case; carrier-never-moves and dedup invariants also tested. PVS regression still green. (4 failing tests in the suite pre-date this work: 2 aiAtomicEval fails exist on clean HEAD; golden-score fail comes from uncommitted user edits to aiImpossibleEval.js.)

**Branching impact: modest.** T16 board 34→42 outcomes (+24%); initial position 66. Hash dedup absorbs most of the blowup.

**Lemma library re-proven under real rules — all 6 hold and STRENGTHENED:** every battery is now uniformly **win in 2** (the rear-ball variants dropped from win-4 to win-2 — pass-then-move lets the ex-carrier reposition same-turn). Battery = 2-ply fuse, period.

**Overnight reduced-game findings (2026-07-08 early AM, pre-fix — all carry reduced-game asterisk):**
- 5/5 walk-backs done: dead zones from T8/T8/T14/T10/T10; games 4&5 died faster than forced (T10 proven-in-7, died in 5).
- **REAL_a822c5_T11: PROVEN LOSS in 7** — the AI had a forced win (reduced rules) at turn 11 of game 3 and lost; human's real-rules interleaved turn flipped the result. **REAL_b36806_T9: PROVEN LOSS in 9** — AI had forced win-in-9, one ply past its 8-ply horizon; died in 6. Diagnosis: **the AI enters races it can't price** — counter-attack is sometimes objectively winning, sometimes suicide, and the difference resolves past its lookahead.
- Perturbation sweep (T9 seed, 224 variants): 115 still dead / **69 flip to BLACK WINS** (any piece relocated to ranks 1–3 — infiltration flips the race; `BALL@d4→e2` = proven black win-in-7 here) / 41 hold undecided (flexibility zone: mid-board g/h-file shadow squares + garrison returns).
- Real-rules rechecks launched (`data/selfplay/realrules_recheck.log`, 2h/fixture): BEN_blackPenult_d4e2, ce0f5f_T7, a822c5_T11, b36806_T9.

## ✅ Real-rules rechecks — RESULTS (completed 2026-07-09 21:34)

All 4 fixtures completed under the full turn grammar (detached nohup run survived; exit 0). Log: `data/selfplay/realrules_recheck.log`.

| Fixture | Reduced-game verdict | Real-rules verdict |
|---|---|---|
| BEN_blackPenult_d4e2 | undecided d7 | **undecided through d7** (18M nodes) |
| REAL_ce0f5f_T7of13 | resistance ≥8 | **undecided through d7**; d8 aborted at 166M nodes (2h budget) |
| REAL_a822c5_T11of17 | PROVEN LOSS in 7 | **PROVEN LOSS in 5** |
| REAL_b36806_T9of15 | PROVEN LOSS in 9 | **PROVEN LOSS in 7** |

Takeaways:
- **The interleaved grammar helps the defender/counter-attacker too.** Both proven losses got *faster* under real rules (7→5, 9→7). White's (human's) "wins" in a822c5 and b36806 were not forced — the AI (black) had a certified forced win at those snapshots and lost anyway because it plays the reduced game. 2 of the 5 real human wins are now classified as AI rules-blind-spot blunders, not forced human wins.
- **b36806's win-in-7 is now inside the live AI's 8-ply horizon.** Once the live engine runs the new turn grammar (Step 0 code), it should find this class of counter-win in play.
- **BEN's d4→e2 defense survives real rules** — still undecided at d7, white's best reply still passive (e1→c2). Strongest known defense in any real-game branch. Next: rerun at d8–9 with a bigger budget.
- ce0f5f T7 resistance confirmed ≥7 under real rules; d8 is unfinished (needs >2h budget).

## ⚠️ STEP 0 — MOVE GENERATOR WAS INCOMPLETE (found 2026-07-07 ~23:00)

`generateTurnOutcomes` (aiLogic.js:156) only knows 4 turn shapes: pass-only, move-only, **move-then-pass**, no-op — every move branch is gated on `!piece.hasBall`. It CANNOT express **pass-first-then-move** (± more passes), i.e., unloading the ball and repositioning the ex-carrier. Real game allows it: game a822c5's actual winning turn was `pass f7→d7, move f7→d8, pass d7→d8` — engine generates 34 outcomes from that position, ZERO wins (walkback said "win in 5" where the real game won in 1; that discrepancy is how it was caught).

Consequences:
- The live AI has always searched a **reduced game** — a strict subset of legal turns. Rules blind spot, not just eval. Likely a real contributor to its beatability, esp. defensively (carrier-unload repositioning).
- **All proof-search verdicts to date are about the reduced game** (both sides truncated) — battery lemmas, walk-backs, resistance claims. Still valid for diagnosing the AI (it plays the reduced game); NOT valid for real-game solvability. Lemmas probably survive re-proof, but must re-verify.
- Fix before persistence/null-move: extend `generateTurnOutcomes` with pass→move(→pass) interleavings; acceptance test = reproduces a822c5's final move; then re-prove `lemma_xo.json` + `lemma_batteries.json`. Expect higher branching factor → costlier searches.
- Also audit: does the backend validate human turns at all, or trust the client? (Real rules = whatever the frontend enforces.)

## Research program (decided 2026-07-07 — supersedes earlier "Next session" plan)

**Central question: is Razzle Dazzle a forced white win?** Everything else is downstream. If solved, "teach the AI to defend" has a hard ceiling (only punishes imperfect white play) and the goal shifts to deriving/encoding the winning method. Note solved ≠ AI worthless — cf. Connect Four: solved for P1 since 1988, humans still lose as P1; optimal defense makes the theoretical win practically hard to execute.

**Evidence is genuinely split:**
- For white-win: tempo asymmetry, human 5-0 vs impossible, walk-back shows game 77e1f2 dead by turn 8 of 15 (before the rank-7 motif was even visible — the motif is the *symptom*, the losing condition is earlier).
- Against: P1/P2/P4 (naked rank-7 ball vs properly-stationed back rank) held UNDECIDED through d8–9 — black's defense holds when not displaced. Tonight's proven games all had black's defenders already scattered. Real question: can white *force* the displacement?

**Feasibility revision:** at EBF~3 the summit is blocked (d14 ≈ 10 days). With null-move (EBF→~2), own cost table says d14 ≈ 2 days, d18 ≈ 1 week. Real wins ran 13–17 turns; if optimal defense can't stretch much past ~18, proving the initial position is a sprint + a week of laptop, not fantasy. If perfect defense drags to 25+, wall returns — unknowable until cheaper plies are exhausted.

### The plan
1. **Let tonight's chain finish** (walk-backs ×5 + perturbation sweep). Perturbation output serves both branches — it's the "derive the winning method" step regardless of solvability.
2. **TT persistence** (~half day): serialize 8 shard Maps to disk, load on startup, SIGINT flush. Proof verdicts are immortal → every run accumulates a permanent atlas. Key format already `hash|depth|sideToMove`.
3. **Null-move pruning + killer ordering + game-record ordering hint** (1–2 days): the EBF 3→2 lever, single biggest win available.
4. **Re-run walk-backs with upgrades**: each game's provable boundary should jump several turns earlier; all proofs feed the atlas.
5. **Summit attempt**: initial position, ~week budget, ordering hints from all 5 games. PROVEN → game solved, write it up. Undecided at d16–18 → real evidence optimal defense survives deep (game may not be white-won). Informative either way.

### Don't do
- Don't grind d14 raw on the original P1/P2/P4 setup fixtures. Cost-prohibitive and likely undecided.
- Don't pursue endgame tablebases (Phase ☠, already ruled out).
- Don't change `aiTransposition.js` for this — that's the LIVE engine's TT, not proof search's.

## Session findings — 2026-07-07 evening (human analysis + ad-hoc proofs)

User analyzed game 2 (ce0f5f) on the replay artifact and produced three results worth keeping:

1. **X/O staging lemma — PROVEN.** User's claim: white pieces on d7+e7 with the ball vs black's T7 garrison (d8, e8-ball, d6, d4) is forced. Verified by proof search (`data/selfplay/lemma_xo.json`): ball on e7 → **win in 2**; ball on d7 → **win in 4** (black's best try d6→c8 — occupying the very corner user circled — still loses). Compositional-proof method working as designed: human proposes lemma by eye, machine certifies in ~1 min.

2. **"Coverage debt" reframing of the back-rank motif.** Leaving the back rank isn't the poison (development is mandatory) — the poison is *unrepaid* departures: defenders' return-distance exceeding white's battery-completion clock. Game 2 black: 5 of 6 moves marched forward, zero repayments until c6→d8 at T12 (one turn before delivery). Candidate eval feature: coverage-debt vs. setup-distance race arithmetic. Perturbation sweep should confirm the survival gradient tracks distance-from-home.

3. **BEN_blackPenult_d4e2 — strongest known defense in game 2.** At the T6 decision point, instead of the played c8→d6, user proposed **d4→e2 + pass e8→e2** (black goes penultimate at white while keeping c8/d8/e8 home — the "flexibility" doctrine). Proof search (`data/selfplay/ben_hypothesis.json`): **undecided through completed depth 7, white to move** — outlives the actual game line (dead 2 turns later) by a wide margin. White's best reply is *defensive* (e1→f3 covering the d1/d2 entry squares) — black's counter-threat forces white to spend tempo defending, the "fortress tax" mechanism. Follow-up: run at d8–9 with a few hours' budget; if it keeps holding, this is the defense-shaped hole in the impossible AI's play.

Also noted: user semantics correction adopted — T7 verdict is "resistance proven ≥8" not "defense existed" (savability still open; verification run's d9+ adjudicates whether user's "undefendable at T7" read is right).

4. **Battery taxonomy — ALL PROVEN** (`data/selfplay/lemma_batteries.json`, garrison d8/e8-ball/d6/d4, black to move). d7+e7 (ball e7: win-2, ball d7: win-4); g6+g7 (ball g7: win-2, ball g6: win-4); g6+h6 (either ball: win-2). Mirror symmetry covers a–d files free. General form: two-piece battery, ball-holder has unblockable lane (adjacent diagonal or clear file) to an empty back-rank square the partner knight-reaches in one move, with a second uncoverable target = proven win; only escape is winning the race ("unless black can win next move"). Front-ball = win-2, rear-ball = win-4. In all six proofs black's best defense was a null shuffle (pass e8→d8). **Strategic collapse: white's job = complete any battery; black's job = deny all batteries simultaneously or out-race. Candidate defense feature: battery-distance differential (white's turns-to-nearest-battery minus black's turns-to-cover/counter).**

## ✅ STEP 2 — DONE (2026-08-31): persistent proof atlas

`proofSearch.js` now persists to the shared position store (`utils/aiPositionStore.js`, `data/positions.db` — same DB the live engine reads via `aiPersistTT` env flags). New flags: `--db <path>` (default data/positions.db), `--persist 0` to disable.

- **Atlas probed at every node including leaves** — a leaf hit chains onto an earlier proof, extending the effective horizon (compositional proofs now automatic). Verified: rerun of SANITY_immediate_win proved at d1 in 4 nodes via atlas hits, correct ply distance preserved; cross-fixture reuse observed within a single run (P2/P4 hit proofs persisted by P1).
- **Soundness hardening:** in-memory TT now carries exact/lower/upper bound flags (cutoffs yield bounds, not exact values — the same gotcha as the live engine's PVS TT). Only certified verdicts persist: exact proofs, lower-bound wins, upper-bound losses. Wrong-direction bounds and undecided scores never touch the DB. Store POV matches the live engine: key `hash|sideToMove`, result from side-to-move's POV, distance-to-terminal, shortest-distance upsert.
- **Writes buffered** (flush every 5k, at each completed depth, and on SIGINT/SIGTERM) — proofs survive the sleep/session kills that murdered the July runs.
- **⚠️ Tainted-proof discovery:** `data/positions.db` held 1,370 rows written by the live engine May 1–3 — all pre-Step-0, i.e. reduced-game verdicts, unsound under real rules. Store is now **game-versioned**: `CURRENT_GAME_VERSION = 2` (full turn grammar); v1 rows are invisible to get/all/size and are replaced by v2 writes regardless of distance. Bump the version if the turn grammar ever changes again.
- Tests: `tests/proofSearchAtlas.test.js` (conversion round-trips, bound gating, end-to-end persist/reuse) + versioning tests in `tests/aiPositionStore.test.js`. Full suite 60/60.

Next per program: **Step 3 — null-move pruning + killer ordering + game-record ordering hints** (the EBF 3→2 lever), then re-run walk-backs (proofs now accumulate), then the summit attempt.

## ✅ STEP 3a — DONE (2026-08-31): killer + history ordering

Killer moves (2 slots per ply, kept across ID iterations) + global history table, on by default, `--killers 0` to disable. Turn signature = position-independent move list, so a refutation found at one sibling gets tried first at the rest. Pure ordering — cannot change verdicts.

**A/B on P1_naked_f7 (--persist 0, identical verdicts at every depth):**

| depth | killers off | killers on | speedup |
|---|---|---|---|
| d5 | 240k | 168k | 1.4x |
| d6 | 2.71M | 1.28M | 2.1x |
| d7 | 6.60M | 2.93M | **2.25x** |

~2.25x constant factor ≈ +1 ply of reach; compounds with the atlas and the new bound-flagged TT probing (which July's runs also lacked).

**⚠️ Step 3b (null-move) design decision — null-move is PROOF-UNSOUND here.** A null-move cutoff asserts "even passing wins," but the empty turn is not legal (search filters no-op outcomes) and near-zugzwang shuffle positions exist. A null-move-derived verdict must NEVER reach the atlas. If implemented, it goes behind an opt-in `--heuristic` triage mode: results reported as "likely", persistence disabled. Sound alternative for more speed: lemma-based recognizers (the six proven battery patterns as pattern-matched terminal nodes).

## STEP 3c — battery-lemma leaf extension: BUILT, VERDICT = DEFAULT OFF (2026-08-31)

`--batteryExt K` (default 0): at a depth-0 leaf whose board shows a penultimate-rank battery threat (any carrier on its penultimate rank + a friendly non-carrier in the opponent's half), search K extra plies instead of returning undecided. Verify-on-match — the pattern is only a trigger, verification is real search, so it is sound by construction (rootDepth bump keeps distance math exact; `inExtension` guard prevents re-extension; validated: depth-1 search returned a correctly-distanced win-in-3 score).

**Gotcha found during A/B: both sides carry a ball.** First trigger version used `findBall` (returns first ball in rank order) and inspected the wrong carrier on two-ball boards. Fixed to scan every carrier. Any future board-pattern code must not assume a single ball.

**A/B results (--persist 0):**

| fixture | baseline | ext4 | verdict |
|---|---|---|---|
| WALK_77e1f2_T10of15 (won) | proves d3, ~22k nodes cum. | proves **d1**, 83k nodes | shallower nominal depth, ~4x more nodes |
| P1_naked_f7 (defended) | d6 done, 1.28M nodes | d5 = 12.7x nodes; **d6 aborted at 21.3M** | 16x+ cost, no new verdicts |

**Why the July "30–80x" hope failed:** the trigger is dense in exactly the positions this program studies — attacker-on-penultimate is nearly every leaf, so the extension pays a 4-ply verification tax on masses of non-wins. Net: sound but node-negative in both regimes tested. **Keep default off.** Salvage path if ever needed: a far tighter trigger matching the actual proven motif (uncovered adjacent goal-rank files + partner knight-reach, per the battery taxonomy above), not the loose "carrier on rank 7" condition.

Also added 2026-08-31: `scripts/auditTurnGrammar.js` — replays all completed Mongo games and asserts every real turn is expressible by `generateTurnOutcomes`. Current: 18 games, 288 turns, 0 gaps. Rerun before any big proof campaign; a Step-0-class generator hole would show up here first.

## Open questions

- Is the rank-7 motif actually forced, or does it require a setup phase that exploits AI weakness? Compositional proof will tell us.
- Why does hard (median 19 turns) lose *slower* than impossible (15 turns)? Possibly NN has defensive blind spots heuristic doesn't.
- Are the 5 real-win positions actually-forced or did impossible blunder? Proof search will distinguish.
