# Port Terminal Simulator

Browser game: run an iron ore export terminal and beat the algorithm on demurrage.

The player decides berthing order and berth use for ships arriving at a fictional iron ore export terminal, and is scored on net demurrage cost against dispatch rules and the hindsight optimum. Parameters are calibrated on an undergraduate thesis on port productivity and demurrage reduction (Ponta da Madeira terminal, ANTAQ data, Jul–Dec 2025).

Status: Level 1 in development. Plain HTML/JavaScript, hosted on GitHub Pages.

## Code layout

- `src/config.js`: level parameters (rates, laytime, demurrage, ship mix)
- `src/random.js`: seeded random arrivals, so every player gets the same ships
- `src/engine.js`: discrete-event simulation engine (no graphics)
- `src/policies.js`: benchmark algorithms (FCFS, fixed plan, brute-force best plan)
- `test/`: checks the engine against the paper hand simulation

Run the tests with Node 22+: `npm test`
