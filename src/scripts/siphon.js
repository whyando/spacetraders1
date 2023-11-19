import fs from 'fs/promises'
import assert from 'assert'

import { sys } from '../util.js'
import Resource from '../resource.js'
import Pathfinding from '../pathfinding.js'

async function get_import_market(universe, systemSymbol, target_imports) {
    const system = await universe.get_system(systemSymbol)

    for (const w of system.waypoints) {
        const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
        if (!is_market) continue

        const market = await universe.get_remote_market(w.symbol)
        if (!market) throw new Error(`expected remote market for ${w.symbol}`)
        
        const market_imports = market.imports.map(x => x.symbol)
        let imports_all = true
        for (const good of target_imports) {
            if (!market_imports.includes(good)) {
                imports_all = false
            }
        }
        if (imports_all) {
            return market.symbol
        }
    }
}

export async function siphon_script(universe, agent, ship) {
    const system = await universe.get_system(ship.nav.systemSymbol)
    const gas_giants = system.waypoints.filter(x => x.type == 'GAS_GIANT')
    assert.equal(gas_giants.length, 1)
    const siphon_location = gas_giants[0].symbol
    const sell_location = await get_import_market(universe, ship.nav.systemSymbol, ['HYDROCARBON', 'LIQUID_HYDROGEN', 'LIQUID_NITROGEN'])

    console.log(`siphon script: ${ship.symbol} at ${siphon_location} -> ${sell_location}`)

    await ship.wait_for_transit()
    while (true) {
        await step(universe, agent, ship, { siphon_location, sell_location })
    }
}

async function step(universe, agent, ship, { siphon_location, sell_location }) {
    const mission = Resource.get(`data/mission/${ship.symbol}.json`, { status: 'siphon'})

    if (mission.data.status == 'siphon') {
        if (ship.cargo.units >= ship.cargo.capacity) {
            mission.data.status = 'sell'
            mission.save()
            return
        }
        await ship.goto(siphon_location)
        await ship.siphon()
        return
    }
    else if (mission.data.status == 'sell') {
        if (ship.cargo.units == 0) {
            mission.data.status = 'siphon'
            mission.save()
            return
        }

        await ship.goto(sell_location)
        const market = await universe.get_local_market(sell_location)
        while (ship.cargo.units > 0) {
            const item = ship.cargo.inventory[0]
            const good = market.tradeGoods.find(g => g.symbol == item.symbol)
            assert(good)
            const quantity = Math.min(good.tradeVolume, item.units)
            await ship.sell_good(item.symbol, quantity)
        }
        assert.equal(ship.cargo.units, 0)
    } else {
        throw new Error(`unknown status: ${mission.data.status}`)
    }
}


export async function siphon_hauler_script(universe, agent, ship, { system_symbol }) {
    throw new Error('wip')
    await ship.wait_for_transit()

    while (true) {

    }
}

