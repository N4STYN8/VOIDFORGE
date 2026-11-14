# Wormhole gates and crew network — handoff for Zach

This release includes both the previously pending modular PvP relay update and the new wormhole gate/network update, preserving the admin-console v2 work. Integrate current main into any deployment branch before building. Do not deploy an older relay checkout. See [the PvP handoff](PVP_RELAY_HANDOFF.md) and [issue 17](https://github.com/N4STYN8/VOIDFORGE/issues/17).

## Deployment

The user explicitly authorized committing/pushing main and publishing the site. Main's existing Pages workflow tests/builds and publishes the browser game. The production relay requires a separate coordinated deployment: this environment has no production SSH credentials and has not restarted it.

1. Inspect/fetch a clean deployment checkout and integrate current main without discarding either developer's work.
2. Back up the running bundle, crew/PvP databases, service configuration and bans. Preserve existing admin secrets, proxy/TLS and origin settings.
3. Run `npm ci`, `npm test`, `npm run build`, `npm run relay-bundle`. Install `dist-relay/relay.mjs` using the existing service procedure; it targets Node 16. Preserve durable `CREW_DATA` and `PVP_DATA` paths from the PvP handoff. Wormholes use existing crew-outpost storage, with no new database or service.
4. Coordinate the relay restart with online pilots. Verify a fresh welcome advertises **`crewProtocol: 1`, `modularPvp: 1`, `wormholes: 1`**. Refresh clients. Crew gate controls remain unavailable on an older relay; personal gates work locally.

## Player controls and mechanics

- F / existing Build Mode contains Warp Gate Frame and Warp Gate Controller. Both use normal paid placement, construction, repairs, upgrades and destruction. Frames must form a completed rectangular perimeter with an empty interior, attached to a live completed core path. One adjacent controller may replace a perimeter cell. Extra controllers, open rings, obstructed openings and critically damaged components disable the assembly.
- Controller levels reach exactly 1/2/3/4/5 sectors by Manhattan distance. Upgrades do not enlarge the physical aperture. Existing Upgrade Station rules apply beyond L2. Ship fit uses installed cells, actual orientation and conservative clearance.
- Click a built frame/controller, press J, or use M → Gate controls. Choose destination coordinates or click a sector in M → Gate network. Review and confirm before charging. Cancel refunds the reserved energy up to battery capacity; heat already generated remains. Destroyed batteries/assemblies do not grant free energy.
- Each activation uses shared outpost energy and heat, takes time and starts a cooldown. L5 Warp Stabilization reduces energy/heat/cooldown by 25% and charge time by 40%, retaining range five. Values live in `WORMHOLE` in `src/data.ts`.
- Crew members see all their crew's persisted gates, including unavailable ones. Other private gates never enter this index. Personal ownership can be explicitly transferred using the existing crew-outpost controls; active charges must first be cancelled.
- The existing map has a gate-network mode, glowing connections, directly reachable cells, route highlighting, zoom/pan and independent per-player route plans. Breadth-first search uses actual usable departure gates within the same grid namespace. Intermediate gates must fit the ship and satisfy current power/heat/cooldown; temporary arrival portals are never nodes. Costs are estimates, revalidated on activation.
- Every hop is confirmed independently. A receiving gate is optional. Arrival searches outside structures/rocks/stations, known ships/reserved arrival positions and boss hazard territories, with no ore deletion. A five-second visual arrival portal grants no departure capability. Only the requester moves; a host's jump freezes the lobby's gathering world rather than transporting everyone.

## Authority, recovery and limits

CrewStore transactions own crew gate validation, energy reservation/refund, charge/cooldown state and durable idempotent request results. Membership is checked at use and on replay admission. Gate completion rechecks geometry, fit, proximity, range and pending combat receipts. Occupied/charging gates reject concurrent activations. Crew records remain usable with the builder disconnected, including passive power/cooling/cooldown updates. No second persistence authority was added.

The browser saves a departure journal before requesting a charge and saves an applied receipt with the arriving pilot before clearing that journal. Unknown outcomes retry the same request ID. A reload during charging resumes the same operation; a failed final save retries without another hop. Source sector state, layout, cargo, health and pilot fields travel through the existing sector serializer. The legacy 400-block pose packet limit is not a ship-building cap: large designs keep sending poses and crew fit checks use the existing multipart combat manifest when registered. Their legacy remote pose artwork may omit the full layout.

**This is not global anti-cheat.** Existing personal saves, loadout bootstrap, reported movement and elected-world terrain still have the trust limits documented in the PvP handoff. Crew gate costs/permissions and replay/concurrency behavior are server-owned and tested; personal gates remain part of the local personal-world simulation. A modified client can still exploit the pre-existing client-reported travel/economy architecture. Actual Pi throughput and live multi-pilot balance need acceptance after deployment.

## Validation and live acceptance

Local validation: 435 tests, game/admin production builds and Node-16-targeted relay bundle pass. Tests cover frame validity, actual orientation, fit/range, heat/power/cooldown, route invalidation, persistence, crew privacy/revocation, charge/refund/concurrent requests, stable receipts and combat-exchange recovery. Real relay sockets verify competing users and independent host travel. Isolated two-browser QA verifies three shared gates, a two-hop plan, reload during charging, two separately confirmed hops, unchanged cargo, correct destination room, no private outpost copies, responsive dialog and no browser errors.

After deployment, repeat with two crew members and one outsider: build/upgrade/damage/repair a frame, plan A → B → C, reject a direct ten-sector L5 jump and an undersized intermediate gate, test partial power/heat/cooldown, disconnect the builder, restart the relay, revoke a member during charging, and reconnect during a departure. Verify each hop charges once, the outsider sees no gate index, personal gates stay private and no arrival becomes a free return gate. Also run the PvP handoff acceptance checks.
