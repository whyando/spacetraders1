import Agent from './agent.js'
import Universe from './universe.js'
import DB from './database.js'
import fs from 'fs/promises'
import assert from 'assert'
import Resource from './resource.js'

const CALLSIGN = 'WHYANDO'

await DB.init()
const universe = await Universe.load()
const agent = await Agent.load(universe, '', CALLSIGN)
universe.client.axiosInstance.defaults.headers['Authorization'] = `Bearer ${agent.token}`

const cmd_ship = agent.ships[`${CALLSIGN}-1`]
console.log(cmd_ship.nav.waypointSymbol)

const tbl = []
for (const ship of Object.values(agent.ships)) {
    // overview of EXPLORER ships
    if (ship.frame.symbol != 'FRAME_EXPLORER') continue
    tbl.push({
        symbol: ship.symbol,
        type: 'SHIP_EXPLORER',
        nav: ship.nav.status,
        waypoint: ship.nav.waypointSymbol,
        fuel: `${ship.fuel.current}/${ship.fuel.capacity}`,
        cargo: `${ship.cargo.units}/${ship.cargo.capacity}`,
        // travel duration
        // cooldown duration
    })
}
console.table(tbl)

// load STARTER_SYSTEMS.log
const starter_systems = (await fs.readFile('STARTER_SYSTEMS.log', 'utf-8')).split('\n').filter(s => s.length > 0).map(s => s.split('\t')[0]).slice(0, 25)

const status = Resource.get(`data/starter_systems.json`, {
    'X1-SA2': {
        ship: 'WHYANDO-1E',
    },
    'X1-CM53': {
        ship: 'WHYANDO-1F',
    },
    'X1-DN94': {
        ship: 'WHYANDO-20',
    },
    'X1-JX82': {
        ship: 'WHYANDO-22',
    },
    'X1-HR68': {
        ship: 'WHYANDO-23',
    },
})
status.save()

for (const system of starter_systems) {
    if (status.data[system]) continue
    status.data[system] = {
        ship: null,
    }
}
status.save()
throw new Error('stop')

async function script_goto_universe_location(ship) {
    const target = target_location[ship.symbol]
    await ship.wait_for_transit()

    while (true) {
        if (ship.nav.systemSymbol == target) {
            console.log(`[${ship.symbol}] Already at target system ${target}`)
            return
        }
        if (ship.nav.waypointSymbol == 'X1-ZA74-A2') {
            await ship.goto('X1-ZA74-I53')
        }

        const system = await universe.get_system(ship.nav.systemSymbol)
        let waypoint = system.waypoints.find(w => w.symbol == ship.nav.waypointSymbol)
        
        // check for pre-jump actions:
        const is_uncharted = waypoint.traits.some(t => t.symbol == 'UNCHARTED')
        if (is_uncharted) {
            const waypoints = await ship.scan_waypoints()
            await universe.save_scanned_waypoints(waypoints)
        }
        waypoint = system.waypoints.find(w => w.symbol == ship.nav.waypointSymbol)
        assert(!waypoint.traits.some(t => t.symbol == 'UNCHARTED'))

        const is_market = waypoint.traits.some(t => t.symbol == 'MARKETPLACE')
        const is_jumpgate = waypoint.type === 'JUMP_GATE'
        if (is_market) {
            const _market = await universe.get_local_market(waypoint.symbol)
            await ship.refuel({maxFuelMissing: 0})
            const cargo_fuel = ship.cargo.inventory.find(c => c.symbol == 'FUEL')?.units ?? 0
            if (cargo_fuel != ship.cargo.capacity) {
                await ship.buy_good('FUEL', ship.cargo.capacity - cargo_fuel)
            }
        }
        if (is_jumpgate) {
            const _conn = await universe.get_remote_jumpgate_connections(waypoint.symbol)
        }
        console.log('pre-jump actions complete')

        const next_step = route[target].find(s => s.from == ship.nav.systemSymbol)
        console.log('next_step', next_step)
        if (next_step.type == 'jumpgate') {
            const system_a = await universe.get_system(next_step.from)
            const system_b = await universe.get_system(next_step.to)
            const waypoint_a = system_a.waypoints.find(w => w.type === 'JUMP_GATE')
            const waypoint_b = system_b.waypoints.find(w => w.type === 'JUMP_GATE')
            assert(waypoint_a.isUnderConstruction === false)
            assert(waypoint_b.isUnderConstruction === false)
            const is_market_a = waypoint_a.traits.some(t => t.symbol == 'MARKETPLACE')
            const is_market_b = waypoint_b.traits.some(t => t.symbol == 'MARKETPLACE')
            const charted_a = !waypoint_a.traits.some(t => t.symbol == 'UNCHARTED')
            const charted_b = !waypoint_b.traits.some(t => t.symbol == 'UNCHARTED')
            const prop_a = []
            const prop_b = []
            if (is_market_a) prop_a.push('MARKET')
            if (is_market_b) prop_b.push('MARKET')
            prop_a.push(charted_a ? 'CHARTED':'UNCHARTED') 
            prop_b.push(charted_b ? 'CHARTED':'UNCHARTED') 
            console.log(`Jumping from ${waypoint_a.symbol} ${prop_a.join(',')} to ${waypoint_b.symbol} ${prop_b.join(',')}`)
            await ship.jump(waypoint_b.symbol)
        } else {
            // we don't want to always warp because it's likely we just scanned a new jumpgate
            // (unless warp is the finish step I guess)
            const step_index = route[target_location[ship.symbol]].findIndex(s => s.from == ship.nav.systemSymbol)
            if (step_index == route[target_location[ship.symbol]].length - 1) {
                // last step
                const target_waypoint = `${target_location[ship.symbol]}-A2`
                await ship.warp(target_waypoint)
            } else {
                console.log(`[${ship.symbol}] Waiting approval for warp.`)
                return
            }
        }
    }
}

// const prom = []
// prom.push(script_goto_universe_location(agent.ship_controller('WHYANDO-1E')))
// prom.push(script_goto_universe_location(agent.ship_controller('WHYANDO-1F')))
// prom.push(script_goto_universe_location(agent.ship_controller('WHYANDO-20')))
// // prom.push(script_goto_universe_location(agent.ship_controller('WHYANDO-21')))
// prom.push(script_goto_universe_location(agent.ship_controller('WHYANDO-22')))
// prom.push(script_goto_universe_location(agent.ship_controller('WHYANDO-23')))

// await Promise.all(prom)

console.log('exit')
DB.destroy()
