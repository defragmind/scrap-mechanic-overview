# AAAHHHHH — 1.0 world data report (seed 935028049)

## Growlabs (6) — minidungeon entrances

- **meadow growlab silodistrict xl** — anchor cell `11,1` (8×8 cells), world pos ~(704, 64)
- **lake growlab island xl** — anchor cell `-57,40` (8×8 cells), world pos ~(-3648, 2560)
- **desert growlab clifftop large** — anchor cell `6,-22` (4×4 cells), world pos ~(384, -1408)
- **meadow growlab quest large** — anchor cell `-37,-19` (4×4 cells), world pos ~(-2368, -1216)
- **burntforest growlab frozen large** — anchor cell `-43,16` (4×4 cells), world pos ~(-2752, 1024)
- **forest growlab station large** — anchor cell `-12,27` (4×4 cells), world pos ~(-768, 1728)

## Underground access

- **EXCAVATION_BRIDGE** — cell `0,-35`
- **SERVICE_ELEVATOR** — cell `-26,-22`
- **EXCAVATION_BRIDGE** — cell `42,-14`
- **EXCAVATION_BRIDGE** — cell `-5,-8`
- **EXCAVATION_BRIDGE** — cell `19,-8`
- **EXCAVATION_BRIDGE** — cell `29,-2`
- **EXCAVATION_BRIDGE** — cell `-6,4`
- **EXCAVATION_BRIDGE** — cell `-31,10`
- **EXCAVATION_BRIDGE** — cell `31,34`

## Quest locations (28)

- AUTUMNFOREST_BUILDERQUEST_MUSICBOX_MEDIUM — cell `23,6`
- AUTUMNFOREST_BUILDERQUEST_POPCORN — cell `-1,31`
- AUTUMNFOREST_CLEARRUINSQUEST_MEDIUM — cell `-13,-30`
- BUILDERQUEST_BAGUETTE_MEDIUM — cell `47,-6`
- BUILDERQUEST_BEESUIT — cell `-11,6`
- BUILDERQUEST_CARDBOARDPOOP — cell `-20,-9`
- BUILDERQUEST_CAROUSEL — cell `29,-33`
- BUILDERQUEST_COMPASS — cell `-26,25`
- BUILDERQUEST_CROWBAR — cell `-29,28`
- BUILDERQUEST_NICEHOUSE_MEDIUM — cell `23,12`
- BUILDERQUEST_RESOURCECAR — cell `-30,-20`
- BUILDERQUEST_SLEDGEHAMMER_MEDIUM — cell `18,21`
- BUILDERQUEST_STEELBRIDGE_MEDIUM — cell `36,6`
- BUILDERQUEST_WOCHOUSE — cell `-23,-25`
- BUILDERQUEST_XYLOPHONE — cell `-37,30`
- BUNK_BURIAL_QUEST_MEDIUM — cell `-33,22`
- BURNTFOREST_BUILDERQUEST_CATAPULT_MEDIUM — cell `-20,21`
- BURNTFOREST_BUILDERQUEST_TOTEBOTKEY — cell `-37,6`
- DESERT_BUILDERQUEST_BIGFAN — cell `-26,6`
- DESERT_BUILDERQUEST_GARDEN — cell `-7,28`
- FIELD_BUILDERQUEST_CORNHEART — cell `-48,25`
- FIELD_BUILDERQUEST_COZYBED — cell `5,-32`
- FOREST_BUILDERQUEST_SAWBLADEARM — cell `25,-6`
- MEADOW_GROWLAB_QUEST_LARGE — cell `-37,-19`
- MECHANICSTATION_QUEST_MEDIUM — cell `-30,-27`
- MECHANICSTATION_QUEST_MEDIUM — cell `-29,-27`
- MECHANICSTATION_QUEST_MEDIUM — cell `-30,-26`
- MECHANICSTATION_QUEST_MEDIUM — cell `-29,-26`

## Resource/loot POIs

- DESERT_OILPOOL — cell `8,-24`
- DESERT_OILPOOL — cell `-32,-9`
- DESERT_OILPOOL — cell `-33,-7`
- DESERT_OILPOOL — cell `-27,-6`
- DESERT_OILPOOL — cell `-4,-6`
- DESERT_OILPOOL — cell `1,6`
- DESERT_OILPOOL — cell `0,24`
- DESERT_OILPOOL — cell `-4,27`
- DESERT_OILPOOL — cell `16,39`
- DESERT_OILPOOL — cell `17,44`
- DESERT_OILPOOL — cell `19,44`
- DESERT_OILPOOL — cell `28,44`
- DESERT_OILPOOL — cell `23,45`
- ROAD_CHEMPOOL — cell `7,-38`
- ROAD_CHEMPOOL — cell `19,-26`
- ROAD_CHEMPOOL — cell `19,-20`
- ROAD_CHEMPOOL — cell `30,-20`
- ROAD_CHEMPOOL — cell `-29,-14`
- ROAD_CHEMPOOL — cell `43,-8`
- ROAD_CHEMPOOL — cell `-18,10`
- ROAD_CHEMPOOL — cell `-25,13`
- ROAD_CHEMPOOL — cell `25,19`
- ROAD_SCHEMATICSTATION — cell `12,-35`
- ROAD_SCHEMATICSTATION — cell `29,-26`
- ROAD_SCHEMATICSTATION — cell `41,-20`
- ROAD_SCHEMATICSTATION — cell `24,-11`
- ROAD_SCHEMATICSTATION — cell `-30,-8`
- ROAD_SCHEMATICSTATION — cell `-13,-5`
- ROAD_SCHEMATICSTATION — cell `23,1`
- ROAD_SCHEMATICSTATION — cell `29,10`
- ROAD_SCHEMATICSTATION — cell `-13,13`
---

# The Mines (Drilling Thunder underground) — 8 depths

Underground is a separate world (id 65535) reached via the excavation island
(surface cells 43..58 x 20..35) and the service elevator at (-26,-22).
Fixed-layout levels ship as world definitions; drill depths are procedurally
cave-generated per seed on first descent.

| Depth | Level | Layout | Map |
|---|---|---|---|
| 1 | Mining Hub | fixed 32x32, 3 portals, 8 quest targets (pylon, caster, dispenser, powerrails, smelter, vault door, vault) | /mines/undergroundworld_mininghub.png |
| 2 | Onboarding | procedural intro caves | — |
| 3 | Station 1 | fixed 20x20, 2 portals | /mines/undergroundworld_station_01.png |
| 4 | Drill 1 | procedural caves/pockets/tunnels | — |
| 5 | Scrapyard | fixed 24x24 | /mines/undergroundworld_scrapyard.png |
| 6 | Drill 2 | procedural caves/pockets/tunnels | — |
| 7 | Station 2 | fixed 20x20 | /mines/undergroundworld_station_02.png |
| 8 | Boss Lobby | fixed 64x64 | /mines/undergroundworld_final_boss_lobby.png |
| — | Trashbot Boss arena | fixed 16x16 | /mines/undergroundworld_trashbot_boss.png |

Growlab interior layouts (7): /mines/growlab_01..07.png (portals marked green).

Current save state: 2 surface entrances discovered at cells (4,-23)/(5,-23);
no underground terrain generated yet (descend once to populate it, then the
extractor can render your seed's actual cave layouts).
