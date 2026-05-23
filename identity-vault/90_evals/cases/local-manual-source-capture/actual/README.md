# Local Manual Source Capture

This fixture is the first concrete capture workflow after the source refresh preflight and connector boundary contracts.

It stays local and deterministic:

- no filesystem crawler;
- no live connector;
- no network call;
- no Hindsight runtime call;
- no database migration;
- no UI.

The fixture proves that an owner-confirmed local/manual source can produce exactly one governed source registry entry and one immutable snapshot, while invalid captures fail closed.
