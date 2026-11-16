# Where the product stands

The overview every conversation starts from. One screen; what is no longer true is removed.

## Strong

## Weak, in the owner's words

- "The whole application flow is a bit janky, especially getting back to the running scans" (16 Nov 2026). The Run page bugs behind most of it are fixed; how the flow should feel is open below.

## What the owner wants next, in their order

## Open with the owner

- App flow (16 Nov 2026): what should happen when a scan finishes, where a refresh/reopen should land while a scan runs, and whether the Run page keeps every scan or only the live one.

## Noticed, not yet raised or settled

- The real-images integration test "MD5 identical pairs are CERTAIN groups" fails on main (its scan result is undefined); not looked into yet.
- Every scan progress message over the WebSocket carries the whole log (up to 2000 lines); fine so far, heavy on very long scans.
