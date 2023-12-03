import fs from 'fs/promises'
import assert from 'assert'
import { sys } from '../util.js'
import Resource from '../resource.js'
import Agent from '../agent.js'
import Universe from '../universe.js'
import DB from '../database.js'

const supply_map = {
    'ABUNDANT': 5,
    'HIGH': 4,
    'MODERATE': 3,
    'LIMITED': 2,
    'SCARCE': 1,
}

async function filter_waypoints(universe, system_symbol, { type, imports, exports, assert_one } = { assert_one: false }) {
    const system = await universe.get_system(system_symbol)
    const filtered = []
    imports = imports !== undefined ? (Array.isArray(imports) ? imports : [imports]) : []
    exports = exports !== undefined ? (Array.isArray(exports) ? exports : [exports]) : []
    for (const w of system.waypoints) {
        const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
        if (type !== undefined && w.type != type) continue

        if (imports.length > 0 || exports.length > 0) {
            if (!is_market) continue
            const market = await universe.get_remote_market(w.symbol)
            const market_imports = market.imports.map(x => x.symbol)
            const market_exports = market.exports.map(x => x.symbol)
            let match = true
            for (const good of imports) {
                if (!market_imports.includes(good)) {
                    match = false
                }
            }
            for (const good of exports) {
                if (!market_exports.includes(good)) {
                    match = false
                }
            }
            if (!match) continue
        }
        filtered.push(w)
    }
    // console.log(type)
    // console.log(filtered)
    if (assert_one) {
        assert.equal(filtered.length, 1)
        return filtered[0]
    }
    return filtered
}


// Only the command ship can run this script, since it has MOUNT_SURVEYOR_II + MOUNT_MINING_LASER_II + ENGINE_ION_DRIVE_II
export async function cmd_extract_script(universe, agent, ship) {
    const system_symbol = ship.nav.systemSymbol

    const asteroid = await filter_waypoints(universe, system_symbol,
        { type: 'ENGINEERED_ASTEROID', assert_one: true })
    const iron_market = await filter_waypoints(universe, system_symbol,
        { imports: 'IRON_ORE', exports: 'IRON', assert_one: true })
    const fabmat_market = await filter_waypoints(universe, system_symbol,
        { imports: ['IRON', 'QUARTZ_SAND'], exports: 'FAB_MATS', assert_one: true })

    console.log(`cmd_extract script: ${ship.symbol} at ${asteroid.symbol} -> ${iron_market.symbol} + ${fabmat_market.symbol}`)

    await ship.wait_for_transit()
    while (true) {
        await step(universe, agent, ship, {
            asteroid: asteroid.symbol,
            iron_market: iron_market.symbol,
            fabmat_market: fabmat_market.symbol,
        })
    }
}

const JETTISON_WHITELIST = [
    'SILICON_CRYSTALS', 'ICE_WATER', 'AMMONIA_ICE', 'QUARTZ_SAND', 'IRON_ORE',
    'COPPER_ORE', 'ALUMINUM_ORE', 'PRECIOUS_STONES', 'DIAMONDS', 'GOLD_ORE', 'SILVER_ORE', 'PLATINUM_ORE'
]

async function step(universe, agent, ship, { asteroid, iron_market, fabmat_market }) {
    const mission = Resource.get(`data/mission/${ship.symbol}.json`, { status: 'complete'})

    if (mission.data.status == 'complete') {
        if (ship.cargo.units > 0) {
            console.log('cargo:', JSON.stringify(ship.cargo))
            throw new Error('cargo not empty')
        }
        mission.data.status = 'extract'
        mission.save()
    }
    else if (mission.data.status == 'extract') {
        for (const item of ship.cargo.inventory) {
            const is_jettison = !(item.symbol == 'IRON_ORE' || item.symbol == 'QUARTZ_SAND')
            if (is_jettison) {                
                if (!JETTISON_WHITELIST.includes(item.symbol)) {
                    throw new Error(`jettison of ${item.symbol} not in whitelist`)
                }
                await ship.jettison(item.symbol, item.units)
            }
        }
        if (ship.cargo.units >= ship.cargo.capacity) {
            mission.data.status = 'sell'
            mission.save()
            return
        }
        await ship.goto(asteroid)

        const surveys = await universe.get_surveys(asteroid)
        const survey_options = surveys.map(s => {
            const iron_ore = s.deposits.filter(d => d.symbol == 'IRON_ORE').length
            const quartz_sand = s.deposits.filter(d => d.symbol == 'QUARTZ_SAND').length
            return { survey: s, iron_ore, quartz_sand }
        })
        survey_options.sort((a, b) => {
            return (b.iron_ore + b.quartz_sand)/b.survey.deposits.length - (a.iron_ore + a.quartz_sand)/a.survey.deposits.length
        })
        const filtered = survey_options.filter(s => ((s.iron_ore + s.quartz_sand)/s.survey.deposits.length >= 0.33))
        console.log(`filtered ${survey_options.length} surveys down to ${filtered.length} surveys`)
        if (filtered.length == 0) {
            await universe.save_surveys(await ship.survey())
        } else {
            const survey = filtered[0].survey
            const resp = await ship.extract_survey(survey)
            if (resp.error) {
                const code = resp.error.code
                if (code == 4221) {
                    // 'Ship survey failed. Target signature is no longer in range or valid.
                    console.log('survey failed, deleting survey')
                    await universe.delete_survey(survey)
                }
                else {
                    throw new Error(`unhandled extract_survey error: ${JSON.stringify(resp.error)}`)
                }
            }
        }
    }
    else if (mission.data.status == 'sell') {
        if (ship.cargo.units == 0) {
            mission.data.status = 'complete'
            return mission.save()            
        }
        const sell = [
            { symbol: 'IRON_ORE', waypoint: iron_market },
            { symbol: 'QUARTZ_SAND', waypoint: fabmat_market },
        ]

        for (const { symbol, waypoint } of sell) {
            let cargo_units = ship.cargo.inventory.find(i => i.symbol == symbol)?.units ?? 0
            if (cargo_units == 0) continue
        
            await ship.goto(waypoint)
            const market = await universe.get_local_market(waypoint)
            const good1 = market.tradeGoods.find(g => g.symbol == symbol)
            assert(good1)

            while (cargo_units > 0) {
                const quantity = Math.min(good1.tradeVolume, cargo_units)
                await ship.sell_good(symbol, quantity)
                await universe.save_local_market(await ship.refresh_market())
                cargo_units = ship.cargo.inventory.find(i => i.symbol == symbol)?.units ?? 0
            }
            assert.equal(cargo_units, 0)
            return;
        }
        throw new Error('no cargo sold')
    } else {
        throw new Error(`unknown status: ${mission.data.status}`)
    }
}

if (import.meta.url == `file://${process.argv[1]}`) {
    const AGENT = process.argv[2]
    const SHIP_ID = process.argv[3] ?? '1'
    await DB.init()
    const universe = await Universe.load()
    const agent = await Agent.load(universe, null, AGENT)
    const ship = agent.ship_controller(`${AGENT}-${SHIP_ID}`)

    await cmd_extract_script(universe, agent, ship)
}
