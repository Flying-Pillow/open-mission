# Handling Emergencies

> As an operator, I want a hard emergency stop when an agent goes rogue, so I can sever transport, stop new launches, and recover the mission safely.

Mission's emergency model is encoded in the workflow reducer as panic state, not as an informal UI convention. That matters because emergency handling has to survive crashes, restarts, and surface reconnects. The persisted runtime state needs to say exactly what happened and what the system is still allowed to do.

## What Panic Means In The Current Reducer

When the reducer ingests `mission.panic.requested`, it performs a concrete state transition:

- mission lifecycle becomes `panicked`
- mission pause state becomes `paused: true` with reason `panic`
- panic state becomes active
- panic policy is copied from the workflow configuration snapshot

The panic state currently includes these policy flags:

| Field | Meaning |
| --- | --- |
| `terminateSessions` | Whether active runtime sessions should be terminated |
| `clearLaunchQueue` | Whether queued launches should be removed |
| `haltMission` | Whether mission progression must remain halted until human recovery |

In the default workflow snapshot, all three are `true`.

## What Happens To The Launch Queue

If `clearLaunchQueue` is enabled, panic is not only a visual stop. The reducer actively clears `launchQueue`. Any task that had already been marked `queued` through that queue is moved back to `ready` when panic is requested.

That gives the operator an important recovery guarantee: queued-but-not-started work is not silently lost, but it is also not allowed to keep launching after a panic stop.

## What Happens To Active Sessions

After normalization, if panic is active and `terminateSessions` is enabled, the reducer emits `session.terminate` requests for any session whose lifecycle is still `starting` or `running`.

That is the hard-stop behavior operators care about. Panic is designed to sever active transport rather than merely suppress future queue processing. If a session is still alive, the engine requests termination.

## Pause Versus Panic

Pause and panic are not interchangeable:

| Mechanism | Intended use | Runtime effect |
| --- | --- | --- |
| Pause | Controlled operator stop | Mission lifecycle becomes `paused`; no emergency semantics are implied |
| Panic | Emergency intervention | Mission lifecycle becomes `panicked`; pause reason becomes `panic`; queue clearing and session termination may be requested |

A normal pause is for governance and pacing. Panic is for containment.

This distinction is important during incident response. A paused mission may still have intact runtime sessions and a recoverable execution queue. A panicked mission is signaling that active work may need to be cut off immediately and that future launches are no longer permitted.

## Clearing Panic And Recovering

When the reducer ingests `mission.panic.cleared`, it does not jump directly back to `running`. Instead it:

- leaves the mission in lifecycle `paused`
- keeps the pause reason as `panic`
- sets `panic.active` to `false`

That design forces a deliberate human recovery step. Clearing panic only exits the emergency state; it does not automatically resume work. The operator must still decide when to move from paused recovery back to active execution.

## Operational Interpretation

For an adopting engineering organization, the concrete emergency semantics are:

1. Panic is persisted mission state, not surface-local state.
2. Panic can clear queued launches before they start.
3. Panic can request termination of active sessions.
4. Clearing panic still leaves the mission paused.
5. Human intervention is required before execution can continue.

That is the correct shape for a safe stop. It prevents automation from outrunning governance during exactly the situations where governance matters most.