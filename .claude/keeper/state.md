# Where the product stands

The overview every conversation starts from. One screen; what is no longer true is removed.

## Strong

## Weak, in the owner's words

- "The whole application flow is a bit janky, especially getting back to the running scans" (16 Nov 2026). Bugs fixed and the agreed flow built (see Settled); the owner judges in use whether it is better now.

## What the owner wants next, in their order

## Open with the owner


## Settled

- Scan flow (16 Nov 2026, owner said "sounds good"): the top-bar pill shows a running scan, turns into "Review N groups" when it finishes until opened; reopening the app mid-scan lands on that scan; the Run page shows only the live scan (or the last finished one when idle), older scans live under Recent scans.

## Noticed, not yet raised or settled

- Running the integration tests overwrites the app's own saved folders and settings in data/ (they point it at temp test folders).

- The real-images integration test "MD5 identical pairs are CERTAIN groups" fails on main (its scan result is undefined); not looked into yet.
- Every scan progress message over the WebSocket carries the whole log (up to 2000 lines); fine so far, heavy on very long scans.
