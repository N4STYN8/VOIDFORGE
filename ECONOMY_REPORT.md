# Economy benchmark

Developer-only repeatable benchmark: `npm run economy`. All models are isolated; no saves are read or written.

Extraction is measured over 60 simulation seconds against one finite reserve with cargo limits lifted for measurement. Delivered income multiplies that ceiling by explicitly assumed mining duty (travel, cargo trips, combat and prospecting occupy the rest). These are estimates, not measured player completion times. Mineral shares represent directed gathering, not guaranteed nearby deposits.

| Build | Measured active ore/min | Assumed duty | Delivered ore/min |
|---|---:|---:|---:|
| Starter (1 × L1) | 539.0 | 45% | 242.6 |
| Early (2 × L2) | 1800.0 | 30% | 540.0 |
| Midgame (3 × L3) | 4319.0 | 20% | 863.8 |
| Advanced (4 × L4) | 7919.0 | 18% | 1425.4 |
| Endgame (4 × L5) | 13680.0 | 18% | 2462.4 |

| Core destination | Additional directed gathering minutes | Cumulative minutes | Target minutes |
|---|---:|---:|---|
| 2 | 20.6 | 20.6 | 15–25 |
| 3 | 38.6 | 59.2 | 45–75 |
| 4 | 86.8 | 146.0 | 120–240 |
| 5 | 315.7 | 461.7 | 360–600 |

Core estimates exclude equipment purchases, repairs and infrastructure. Efficient multi-beam builds can beat the target; poor mineral access can exceed it. No resource is boss-exclusive.

| Module | L1 purchase minutes at starter common income | Upgrade 1→2 / 2→3 / 3→4 / 4→5 (total minerals) |
|---|---:|---|
| Autocannon | 0.37 | 180 / 510 / 1375 / 3800 |
| Pulse laser | 0.62 | 300 / 810 / 2095 / 5600 |
| Railgun | 1.07 | 520 / 1360 / 3415 / 8900 |
| Plasma cannon | 0.99 | 480 / 1260 / 3175 / 8300 |
| Missile launcher | 0.93 | 450 / 1185 / 2995 / 7850 |
| Flak cannon | 0.66 | 320 / 860 / 2215 / 5900 |
| EMP emitter | 1.32 | 640 / 1660 / 4135 / 10700 |
| Mining beam | 0.31 | 150 / 435 / 1195 / 3350 |
| Tractor beam | 0.58 | 280 / 760 / 1975 / 5300 |
| Cargo hold | 0.27 | 130 / 385 / 1075 / 3050 |
| Armor plating | 0.33 | 160 / 460 / 1255 / 3500 |
| Shield generator | 0.91 | 440 / 1160 / 2935 / 7700 |
| Speed booster | 0.56 | 270 / 735 / 1915 / 5150 |
| Reactor | 1.03 | 500 / 1310 / 3295 / 8600 |
| Cooling system | 0.47 | 230 / 635 / 1675 / 4550 |
| Build module | 2.35 | 1140 / 2910 / 7135 / 18200 |

A complete L5 autocannon costs 3000 iron, 1500 copper, 870 crystal, 410 ice, 175 radioactive: approximately 3.6 additional directed-gathering minutes after core 5 with the assumed endgame build.

| Combat sample | Minerals per defeat | At 2 defeats/min (scenario) |
|---|---:|---:|
| raider | 6 | 12 |
| tank | 20 | 40 |
| carrier | 29 | 58 |
| warden | 295 | 590 (boss scenario is not sustainable; respawn/repeat reward rules apply) |
| leviathan | 210 | 420 (boss scenario is not sustainable; respawn/repeat reward rules apply) |
| titan | 300 | 600 (boss scenario is not sustainable; respawn/repeat reward rules apply) |

Automation: L1 hangar 2 drones × 2 ore/s = 240/min active ceiling, 72/min away ceiling, before flight/service/depletion/storage. Launch costs 8 energy/trip. L1 core+hangar+storage cost 855 minerals, plus builder/core unlocks. Mining consumes real reserves and stops when storage fills.

| Seed / sample region | Iron | Copper | Crystal | Ice | Radioactive |
|---|---:|---:|---:|---:|---:|
| economy-alpha / home | 10895 | 5393 | 399 | 510 | 703 |
| economy-alpha / rare field | 723 | 1427 | 1141 | 1351 | 19465 |
| economy-beta / home | 4443 | 2647 | 144 | 101 | 3094 |
| economy-beta / rare field | 1288 | 20471 | 1259 | 1746 | 2467 |
| economy-gamma / home | 9025 | 7502 | 362 | 629 | 5499 |
| economy-gamma / rare field | 2423 | 1846 | 1976 | 1123 | 24407 |

Audit: the former linear 1–4× upgrade prices and flat 10-radioactive final gate were tiny relative to multi-beam income; infrastructure was inexpensive. Common mining yields/rewards/renewal timings remain intact. New worlds use common-weighted fields, guaranteed rare field types and area-scaled asteroid reserves; legacy specs keep their original yields. New paid investment ledgers prevent repricing old modules into free minerals. Discounts remain restricted to outpost construction/upgrades and never reduce core/module prices.

Next: human timed runs should validate assumed travel/duty and mineral targeting; tune configuration from those measurements.

