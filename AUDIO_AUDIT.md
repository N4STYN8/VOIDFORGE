# Industrial audio audit — 2026-11-13

## Findings and fixes

| Area | Audit finding | Result |
|---|---|---|
| Forge deposits | Actual E transfer had no unload cue | Real transferred amount queues one three-stage unload: clamp, rattles, confirmation. 100+ minerals use the deeper/longer variation; 500+ lower pitch again. No deposit cue for empty/failed transfers. |
| Outpost/fleet deposits | Manual outpost deposits used a generic pickup; ship switching silently unloaded | Same amount-based unloading cue for successful partial/full outpost transfers and fleet unloading. Dedicated load cue for withdrawals. |
| Outfitter/build UI | Generic success tone; model effects could reset before paused actions were heard | Persistent bounded action-sound queue for install, upgrade, L5 upgrade, move/swap, removal, fleet buy/switch and real repairs. Opening/closing the outfitter has its own cues; failures retain the existing rejection sound. |
| Collection | One pure tone per visual collection event | Frame aggregation, 150ms cadence, bounded four-step pitch variation, metallic small pickup and heavier 20+ aggregate pickup. |
| Mining | Two continuous electrical oscillators, no cutting texture | Reused continuous loop adds filtered looping noise; intensity scales with beam count. Clean gain fade/node cleanup on stop, no power/target, pause, settings, menu, mute and hidden tab. |
| Weapons | All seven already had distinct cues; only L5 changed pitch | Retained identities, added ballistic grit, rail impact, plasma instability, missile ignition, clustered flak and EMP noise. Pitch deepens progressively with levels. Actual paid ultimate shots add a throttled high-priority discharge. |
| Ship systems | Damage/death/module destruction existed; boost profile was unused; several ability/warning triggers missing | Boost/Warp, Command Overclock, reactor overdrive, cooling purge, Fortress, Aegis, Vortex and real Industrial Excavator spikes now cue. Added low-energy/heat warnings with rearm thresholds/cooldowns, shield depletion/recovery, and respawn. Existing hull/shield impacts and death remain. |
| Outposts | Turrets, drones, shield impacts and destruction already cued | Preserved those; added placement/upgrade/repair persistence, one-time construction completion, shield activation/recovery and structure hit sounds. Real automatic station/fabricator repair progress cues are rate-limited. |
| Menu | Hover/click/warning existed | Added distinct open, confirmation, cancel and launch cues through the same instance/settings; no music restarts. |

## Mixing and lifetime

- Same Web Audio context, music track, master/effects/music settings, mute and browser unlock path. No libraries or added sound assets.
- Low-priority one-shots stop admitting at 10 active sources, medium at 16, critical at 24. Important cues can preempt lower-priority sources; deposits have precedence. A layered cue reserves its entire cost before allocating nodes.
- Maximum 24 one-shot sources, plus the bounded mining/tractor loop sources. Each oscillator/noise source disconnects itself and its private filter/gain on completion. Shared deterministic noise buffer is generated once; no simulation RNG changes.
- Deposit variations share a 650ms cadence. One unload sequence lasts less than one second; no frame/approach polling creates success sounds.
- Audio quantities use a separate event amount field; particle counts and graphics remain unchanged. Action cues are transient and not serialized.

## Verification

- 269 tests (including the latest multiplayer suite): existing simulation/network/persistence coverage plus real/empty/out-of-range deposits, partial/full outpost storage, actual fleet unloading, paused action persistence, normal charges, repair/ultimate success gating and construction completion once.
- Browser tests: small/full/empty Forge unload, large aggregated collection, continuous three-source mining loop and stop/pause/menu cleanup, paused outfitter purchase/upgrade audio, paid Overclock/Warp, mute/effects-volume gating and the same music element across transitions.
- OfflineAudioContext stress render: all weapon classes, repeated cues, critical damage/explosions and full-hold unload. Verified deposit admission, <=24 active one-shots, no clipping and zero remaining one-shots after render. Exact final peak/RMS recorded in PROGRESS.md.
- Production build passes; pre-existing bundle-size warning remains.

## Remaining gaps

- Remote pilots do not broadcast individual weapon-audio events; this change intentionally leaves the multiplayer wire protocol/relay untouched. Local and existing shared-authority cues remain audible.
- Human listening on headphones and small speakers is still needed to tune bass/confirmation balance and subjective loudness. No new music or ambience assets were added; Deep Space Patrol is unchanged.
- The old one-shot `mine` profile remains for compatibility; continuous mining uses its persistent loop instead.

## Visible-only audio and stronger effects — 2026-11-13
- World cues now require an origin inside the exact camera rectangle, without the rendering preload margin. Applies to shots, impacts, deaths, pickups, structure cues and tool targets. Removed global hit/kill-counter playback, which lost the event position. UI/action confirmation remains audible independently of world visibility.
- Effects bus now has 2.6x gain; low-priority cues stay restrained. Mechanical shots, hits, hull damage and cargo/module operations add decaying inharmonic metallic resonances. Brief music ducking gives actions room; existing volume/mute controls and track remain intact. Compressor plus bounded soft saturation protects the output.
- 280 tests pass. Real-browser off-screen/visible event checks pass with no errors. Offline render measured 2.599x RMS versus the former mix; crowded combat peak 0.270, maximum 24 sources and zero remaining sources after completion. Browser verified music ducks then restores.
- Subjective headphone/speaker listening remains the next tuning step. Local changes only, alongside the ship zoom fix; no relay/protocol changes.
