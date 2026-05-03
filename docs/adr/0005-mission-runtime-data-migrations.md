# Mission Runtime Data Migrations

Mission persists workflow runtime state in Mission runtime data. That data includes Mission task runtime state, Agent session runtime state, configuration snapshot, and Derived workflow state. Agent session context and Mission artifact references are part of daemon-owned runtime state, but they do not currently have independent persisted schema versions.

The Mission runtime schema version applies to the Mission runtime data as a whole. The daemon persistence layer is responsible for validating this version before any Airport surface receives state. Unsupported schema versions and invalid runtime data are rejected instead of being interpreted by surfaces, patched with per-field fallbacks, or repaired with load-time normalization.

Mission runtime data validation is schema-first and clean-slate: the runtime data shape and every nested persisted runtime shape that needs validation must be defined as Zod v4 schemas, and exported TypeScript data types such as `MissionRuntimeData` must be inferred from those schemas with `z.infer`. TypeScript-only interfaces may describe behavior-only contracts, but they are not canonical for persisted or externally accepted runtime data. Runtime loading must not contain fallback parsers, compatibility aliases, or normalization layers that silently rewrite invalid data into an accepted shape.

Future runtime data replacements require an explicit new decision and a deliberate conversion path outside ordinary State store hydration. Hidden compatibility behavior is not part of the Mission runtime data contract.

With Mission dossier-backed persistence, State store hydration validates the Mission dossier before exposing hydrated state through the Mission state store. After hydration, active Mission work uses the daemon in-memory datastore; the Mission dossier is updated through daemon-owned checkpoints after every accepted State store transaction rather than being repeatedly read as a live state source.

Mission runtime migrations do not define rollback semantics for accepted State store transactions. If a later Mission dossier checkpoint fails, the daemon keeps the accepted in-memory state live and marks the Mission for recovery attention instead of attempting to revert runtime state or external worktree changes. Mission recovery attention does not block new State store transactions unless a future safety policy explicitly changes that behavior.

Airport surfaces use Entity schemas, System snapshots, Entity events, and the Daemon protocol version for runtime compatibility. They do not perform Mission runtime migrations, and they do not negotiate separate Agent session context or Mission artifact schema versions.

This keeps compatibility decisions explicit, avoids schema-version leakage into surface code, and preserves a small canonical model for Agent session context and Mission artifact state.

`MissionRuntimeData` is the TypeScript type for the Mission runtime data. New documentation should use Mission runtime data unless it is explicitly referring to the TypeScript type.
