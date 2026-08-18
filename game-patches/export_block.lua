-- ============================================================================
-- sm_overview export block  (for Scrap Mechanic 1.0.x)
-- ============================================================================
-- Scrap Mechanic 0.6.6+ blocked sm.json.save from writing to arbitrary paths,
-- so the world data is dumped to the game log instead and extracted afterwards.
--
-- 1.0 CHANGES vs 0.7.x this block adapts to:
--   * terrain_overworld.lua's Load() was restructured: the paste point is now
--     after CreateCellDataStorage() (CreateCellTileStorageKeys no longer exists).
--   * forEveryCell / GetCellTileUid are no longer guaranteed in scope here, so
--     this block iterates g_cellData directly (self-contained).
--   * Cell tiles are identified by uid; GetLegacyID (from the patched
--     tile_database.lua) resolves the pre-0.6 legacy id the map images use.
--     Tiles that have no legacy id (new in 0.7/1.0) export as tileid -1 and
--     render as terrain color on the map.
--
-- WHERE TO PASTE THIS:
--   In your game's  .../Survival/Scripts/terrain/terrain_overworld.lua
--   inside the Load() function, in the  if sm.terrainData.exists() then  block,
--   PASTE THIS ENTIRE BLOCK immediately AFTER the line:   CreateCellDataStorage()
--   and BEFORE the line:                                    return true
--
-- OR automate it with:  bash tools/apply-patch.sh
--
-- ALSO REQUIRED (step 2a): replace your game's
--   .../Survival/Scripts/terrain/overworld/tile_database.lua
--   with the included game-patches/tile_database.lua  (adds GetLegacyID).
--
-- SAFETY: the block runs once per session and is wrapped in pcall(), so even
-- if something goes wrong it logs an error and never breaks your game's load.
-- ============================================================================

		-- === sm_overview export (1.0.x: dump cells.json to the game log) ===
		local _ok, _err = pcall( function()
			local already = sm.terrainGeneration.getTempData( "STORAGE_CELLJSON" ) or false
			if already == false then
				local cells = {}
				for cellY = g_cellData.bounds.yMin, g_cellData.bounds.yMax do
					for cellX = g_cellData.bounds.xMin, g_cellData.bounds.xMax do
						local cell = {}
						cell["x"] = cellX
						cell["y"] = cellY
						cell["tileid"] = GetLegacyID( g_cellData.uid[cellY][cellX] ) or -1
						cell["flags"] = g_cellData.flags[cellY][cellX]
						cell["rotation"] = g_cellData.rotation[cellY][cellX]
						cells[#cells+1] = cell
					end
				end
				if #cells > 0 then
					cells[1]["bounds"] = g_cellData.bounds
					cells[1]["seed"] = g_cellData.seed
					sm.log.info( "--- START COPYING AFTER THIS LINE FOR CELLS.JSON ---" )
					local json = sm.json.writeJsonString( cells )
					sm.log.info( json )
					sm.log.info( "--- STOP COPYING BEFORE THIS LINE FOR CELLS.JSON ---" )
					cells = nil
					json = nil
					sm.terrainGeneration.setTempData( "STORAGE_CELLJSON", true )
				end
			end
		end )
		if not _ok then sm.log.info( "sm_overview export error: "..tostring( _err ) ) end
		-- === end sm_overview export ===
