# Runtime-Defined Agent Session Messages

Mission exposes Agent sessions as controlled daemon Entities while many agents still run inside terminal-backed CLI applications. Raw terminal input remains available for native CLI interaction, but it is not the canonical channel for Mission-controlled operator intent or Agent session context changes.

Agent session messages are structured non-terminal messages sent through the daemon. The base Agent runtime defines common runtime messages, and each Agent child runtime may advertise additional supported messages. Surfaces must derive available structured controls from the Agent session's advertised runtime messages instead of hardcoding runtime-specific commands.

Supported structured messages are advertised as Agent runtime message descriptors, not as broad boolean capabilities or UI methods. A descriptor names the message type, label, input shape, delivery behavior, and whether it mutates Agent session context. Delivery behavior is best-effort because Agent sessions are indeterministic and may ignore, misunderstand, or fail to structurally acknowledge messages. This lets the daemon validate messages and lets surfaces render controls without knowing child-runtime implementation details.

Daemon-owned context messages may update Agent session context before optional delivery to the Agent runtime. The context mutation is canonical when accepted by the daemon, regardless of whether runtime delivery succeeds or receives a useful response. Operator-facing syntax such as slash commands is shorthand only: for example, `/read @PRD.md` should be parsed by Mission into a structured context operation against an Artifact Entity, not treated as a canonical message type or raw terminal text whose effect is inferred later. The daemon owns shorthand parsing and validation because it owns Entity identity, permissions, runtime message descriptors, context mutation, delivery attempts, and audit records; surfaces may provide autocomplete or previews but do not define canonical parse results.

Mission must distinguish daemon-accepted context mutation, runtime delivery attempt, runtime output observation, and operator/system interpretation of that output. Agent runtime responses are observations in the Agent session log unless a future daemon-validated state model explicitly promotes them.

This preserves the terminal as the live CLI surface while keeping Mission authoritative over context, auditability, permissions, and structured operator commands.

External agent prompt fields always submit Agent session messages, including plain text operator prompts. Raw terminal input is reserved for direct interaction inside the terminal pane.

Agent session messages are not first-class durable Entities for now. Delivered interaction is recorded by the Agent session log, while lasting context changes are stored in Agent session context. Raw Agent session logs are daemon-owned audit material, not Mission artifacts by default. Curated material derived from a log becomes an Agent-session artifact only through explicit daemon or operator promotion. A separate queryable message Entity can be introduced later if replay, search, or independent lifecycle requirements appear.
