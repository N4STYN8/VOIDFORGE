# Modular PvP relay handoff for Zach

## Status and integration

The modular PvP client and relay changes are prepared on top of `ad67ad2` (your merged admin-console v2 update). The site remains backward-compatible with the currently running relay. A live capability check on 2026-11-14 returned `crewProtocol: 1` and no `modularPvp` capability. Therefore publishing the site alone DOES NOT enable modular PvP.

The user authorized publication and explicitly requested this repository handoff if relay deployment was blocked. This Codex environment has no SSH configuration, private keys or SSH agent, so it cannot update the Pi. No production relay restart, admin-secret change, hosting-setting change or database overwrite was attempted.

**Zach: deploy the new relay from the tested release/current main and configure durable `PVP_DATA`.** If the release is already on main, no second feature merge is needed. If you work from an older admin branch, integrate current main first, preserving both developers' changes. Do not build/deploy an old relay branch that lacks this feature.

## Build and deployment

1. In a clean checkout, inspect status, fetch, and safely update to the tested main/release. Preserve local work; never reset/force-push.
2. Run `npm ci`, `npm test`, `npm run build`, and `npm run relay-bundle`. The bundle is `dist-relay/relay.mjs` and targets the existing Node 16 host. Admin console v2 source is included; admin assets have their own existing deployment procedure.
3. Inspect the actual service user/unit and coordinate the restart with the other developer. Check online pilots; restarting drops their sockets. Back up the existing relay bundle, existing crew database, any existing PvP database, bans and service configuration. Keep existing admin secrets/drop-ins unchanged.
4. Configure a separate systemd drop-in for `voidforge-relay`, preserving every existing environment setting:

   ```ini
   [Service]
   Environment=PVP_DATA=/var/lib/voidforge/pvp.json
   ```

   Create `/var/lib/voidforge` if needed and make it writable by the service's actual user. Keep `CREW_DATA` on its existing persistent path. Never delete either ledger to perform an ordinary deployment: pending receipts are needed for recovery.
5. Use the existing `server/README.md` upload/backup/install procedure to install the new bundle, then daemon-reload and restart the relay once. Do not replace the systemd unit, admin password, nginx configuration, bans, or crew data with local defaults.
6. Verify service health, existing admin login/activity/observer features, existing crew state and the new welcome capability `modularPvp: 1`. New clients activate the feature only after that capability and successful registration. Have players reload the current site after the relay restart: older clients do not participate in the modular path, and are not silently registered merely because their pilot has a historical ledger record.

## Acceptance checks

- Two strangers outside station rings: aim at an exterior component. Integrity accumulates damage, the component detaches, and the core stays alive. A healthy disconnected island goes offline rather than triggering unlimited detachment.
- Destroy a loaded cargo hold: core storage fills first, then holds in stable grid order. Only that hold's actual resources (plus newly disconnected holds) leave the ship. Visible containers differ from mineral gems.
- Use an existing tractor on cargo and a rotating component. Full holds do not delete overflow: partial contents remain available; changing capacity before acknowledgement returns unaccepted quantities to the original container.
- Defender, attacker and third party can recover unclaimed salvage; simultaneous requests cannot duplicate an object. Unclaimed remnants remain available even if a partial looter disconnects before its receipt is acknowledged.
- At a station, inspect Recovered components in the outfitter. Pay the displayed repair cost before installation; tier/attachment rules still apply. Scrapping yields a configured fraction of the actual/legacy investment once. Recovered parts are never automatically functional.
- Hit the exposed core: defeat occurs once, one kill is credited, remaining cargo/components become salvage, and R follows existing paid home-rebuild rules. Lost components do not reappear after rebuild.
- Disconnect/reconnect/restart while damage or collection receipts are pending. Confirm receipts are redelivered once and inventories do not duplicate. Do not erase `PVP_DATA` or client receipts to test this.
- Confirm safe rings, lobby/crew friendly-fire protection, NPC combat, mining, cargo ejection, normal mineral tractors, music, mute and volume remain functional.

## Authority and limitations — do not overstate security

The new relay owns projectile generation from installed weapon definitions, fire-rate checks, swept rotated-grid intersections, component/core damage, salvage IDs, escrow activation, collection ordering, partial reservations and durable grants. Direct client requests to create salvage/grant inventory do not exist. Registered pilots reject the old peer-authored PvP damage/cargo-award routes. The defender's acknowledged actual debit bounds released cargo, and source-component acknowledgements prevent stale events from duplicating already-removed parts.

**The existing game still imports personal saved loadouts/cargo and reported movement from clients. The elected sector authority supplies the canonical world specification, clock, rock changes and NPC snapshots.** The relay cannot prove that a modified client honestly debited its private save, earned its bootstrap inventory, or moved legally. This implements replay/concurrency safety within the current trust model, NOT global anti-cheat or an authoritative personal economy. A malicious save/client remains outside the claimed protection; migrating personal inventories/progression and movement to a server-owned account simulation is follow-up work.

The initial modular-PvP server uses the real base weapon damage/tier/cadence/speed tables, flak spreads, EMP radius and higher-tier rail/blast adjacency, with at most two direct detachments per L5 qualifying hit. Base shots are sent only after the normal client power/heat payment. Full server-side parity for paid ultimate secondary nova fields, missile swarms, reflection/cascade and defensive activation windows is NOT claimed; existing PvE ultimates remain unchanged. Combat-time shield/structural recovery should receive a balance/parity review before calling this a final competitive ruleset.

Salvage drifts/spins under a bounded object/shot/queued-hit budget. After the configured lifetime or room clutter budget it leaves the visual world; unclaimed cargo returns to the original owner's stored minerals and components to their salvage locker through durable receipts, rather than deleting resources. Client saves hold recovered modules, original paid-shot counter snapshots, combat-life identity, and receipt watermarks. Active world salvage belongs to the relay ledger, not duplicated private world saves. Large manifests/snapshots use bounded multipart messages rather than a new gameplay module-count cap.

The remaining production prerequisite is the relay deployment and live two/three-player verification on the Pi. Actual-host performance and human combat balance still need observation.
