import commandLineArgs from 'command-line-args'
import assert from 'assert'

import Agent from './agent.js'
import Universe from './universe.js'
import { sys } from './util.js'
import Resource from './resource.js'
import DB from './database.js'

import market_probe_script from './scripts/market_probe.js'
import trading_script from './scripts/trading.js'
import shipyard_probe_script from './scripts/shipyard_probe.js'
import probe_idle_script from './scripts/probe_idle.js'
import gate_builder_script from './scripts/gate_builder.js'
import contract_script from './scripts/contract.js'
import { siphon_script, siphon_hauler_script } from './scripts/siphon.js'
import supply_chain_trader from './scripts/supply_chain_trader.js'
import supply_chain_trader_v2 from './scripts/supply_chain_trader_v2.js'
import fuel_trader from './scripts/fuel_trader.js'
import { cmd_extract_script } from './scripts/cmd_extract.js'

const get_config = (agent_symbol) => {
    const CONFIG = {
        cmd_ship: 'trade', // none, trade, fuel, contract
        enable_probe_market_cycle: true,
        cmd_ship_idle_on_probe_shipyard: false,
    
        probe_all_markets: false,
        probe_all_shipyards: true,
        num_trade_haulers: 0,
        num_supply_trade_haulers: 0,
        num_supply_trade_v2_haulers: 0,
        num_siphon_drones: 0,
        enable_fuel_trade_hauler: false,
        enable_buying_ships: true,
        error_on_missing_ship: true,
        enable_scripts: true,
    }
    if (agent_symbol == 'WHYANDO') {
        CONFIG.num_supply_trade_haulers = 2
        CONFIG.num_supply_trade_v2_haulers = 2
        CONFIG.enable_probe_market_cycle = false
        CONFIG.num_trade_haulers = 1
        CONFIG.num_siphon_drones = 10
        CONFIG.enable_gate_builder = false
        CONFIG.cmd_ship = 'none'
    }
    else if (agent_symbol == 'JAVASCRPT-GOOD') {
        CONFIG.enable_probe_market_cycle = false
        CONFIG.probe_all_markets = true
        CONFIG.cmd_ship = 'extract'
        CONFIG.enable_gate_builder = false // true
    }
    else if (agent_symbol == 'PYTHON-BAD') {
        CONFIG.num_trade_haulers = 3
    }
    return CONFIG
}


// todo: add ship filters for type, callsign, etc
const optionDefinitions = [
    { name: 'agents', alias: 'a', type: String, multiple: true, defaultOption: true },
]

async function main() {
    const options = commandLineArgs(optionDefinitions)
    console.log(options)
    if ((options.agents?.length ?? 0) == 0) {
        console.log('Usage: node src/index.js <agent1> <agent2> ...')
        throw new Error('No agents specified')
    }

    const agents = options.agents.map(x => {
        if (!x.includes(':')) {
            return {
                faction: 'ASTRO',
                callsign: x,
            }
        }
        const [faction, callsign] = x.split(':')
        return { faction, callsign }
    })

    await DB.init()
    const universe = await Universe.load()
    await Promise.all(agents
        .map(agent => run_agent(universe, agent))
    )
}

async function run_agent(universe, agent_config) {
    const { faction, callsign } = agent_config
    const CONFIG = get_config(callsign)
    const agent = await Agent.load(universe, faction, callsign)
    console.log(`Agent ${callsign} loaded`)
    const num_ships = Object.keys(agent.ships).length
    console.log(`Summary: ${num_ships} ships $${agent.agent.credits}`)

    const system_symbol = sys(agent.agent.headquarters)
    console.log('Starting system:', system_symbol)

    // system markets + shipyards (remote)
    const system = await universe.get_system(system_symbol)
    const shipyards = []
    const markets = []
    for (const w of system.waypoints) {
        const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
        const is_shipyard = w.traits.some(t => t.symbol == 'SHIPYARD')

        if (is_market) {
            const market = await universe.get_remote_market(w.symbol)
            markets.push(market)
        }
        if (is_shipyard) {
            const shipyard = await universe.get_remote_shipyard(w.symbol)
            shipyards.push(shipyard)
        }
    }
    const shipyard_waypoints = {}
    for (const shipyard of shipyards) {
        for (const ship_type of shipyard.shipTypes) {
            if (!(ship_type.type in shipyard_waypoints)) {
                shipyard_waypoints[ship_type.type] = []
            }
            shipyard_waypoints[ship_type.type].push(shipyard.symbol)
        }
    }

    // load stage-runner state
    const stage_runner = Resource.get(`data/stage_runner/${callsign}.json`, 
    {
        spec: {
            stage: 'A',
            jobs: [],
        },
        status: {
            jobs: {},
        }
    })

    // Set spec
    const probe_waypoints = new Set()
    const jobs = {}
    const { stage } = stage_runner.data.spec
    if (CONFIG.probe_all_markets) {
        for (const m of markets) {
            probe_waypoints.add(m.symbol)
        }
    }
    if (CONFIG.probe_all_shipyards) {
        for (const s of shipyards) {
            probe_waypoints.add(s.symbol)
        }
    }
    for (const waypoint of probe_waypoints) {
        const id = `idle_probe/${waypoint}`
        jobs[id] = {
            type: 'idle_probe',
            ship_type: 'SHIP_PROBE',
            params: {
                waypoint_symbol: waypoint,
            },
            priority: waypoint == shipyard_waypoints['SHIP_PROBE'][0] ? 100 : 50,
        }
    }

    if (CONFIG.cmd_ship_idle_on_probe_shipyard) {
        const waypoint = shipyard_waypoints['SHIP_PROBE'][0]
        jobs[`idle_probe/${waypoint}/cmd`] = {
            type: 'idle_probe',
            ship_type: 'SHIP_COMMAND',
            params: { waypoint_symbol: waypoint, },
        }
    }
    else if (CONFIG.cmd_ship == 'trade') {
        jobs[`trading/${system_symbol}/cmd`] = {
            type: 'trading',
            ship_type: 'SHIP_COMMAND',
            params: { system_symbol },
        }
    } else if (CONFIG.cmd_ship == 'fuel') {        
        jobs[`fuel_trading/${system_symbol}/cmd`] = {
            type: 'fuel_trading',
            ship_type: 'SHIP_COMMAND',
        }
    } else if (CONFIG.cmd_ship == 'contract') {
        jobs[`contract/${system_symbol}/cmd`] = {
            type: 'contract',
            ship_type: 'SHIP_COMMAND',
            params: { system_symbol, },
        }
    } else if (CONFIG.cmd_ship == 'extract') {
        jobs[`extract/${system_symbol}/cmd`] = {
            type: 'cmd_extract',
            ship_type: 'SHIP_COMMAND',
        }
    }
    for (let i = 1; i <= CONFIG.num_trade_haulers; i++) {
        jobs[`trading/${system_symbol}/${i}`] = {
            type: 'trading',
            ship_type: 'SHIP_LIGHT_HAULER',
            params: { system_symbol },
        }
    }
    for (let i = 1; i <= CONFIG.num_supply_trade_haulers; i++) {
        jobs[`supply_trading/${system_symbol}/${i}`] = {
            type: 'supply_trading',
            ship_type: 'SHIP_LIGHT_HAULER',
        }
    }
    for (let i = 1; i <= CONFIG.num_supply_trade_v2_haulers; i++) {
        jobs[`supply_trading_v2/${system_symbol}/${i}`] = {
            type: 'supply_trading_v2',
            ship_type: 'SHIP_LIGHT_HAULER',
        }
    }
    for (let i = 1; i <= CONFIG.num_siphon_drones; i++) {
        jobs[`siphon_drone/${system_symbol}/${i}`] = {
            type: 'siphon_drone',
            ship_type: 'SHIP_SIPHON_DRONE',
        }
    }
    if (CONFIG.enable_fuel_trade_hauler) {
        jobs[`fuel_trading/${system_symbol}/1`] = {
            type: 'fuel_trading',
            ship_type: 'SHIP_LIGHT_HAULER',
        }
    }
    if (CONFIG.enable_probe_market_cycle) {
        jobs[`market_probe/${system_symbol}/1`] = {
            type: 'market_probe_cycle',
            ship_type: 'SHIP_PROBE',
        }
    }
    if (CONFIG.enable_gate_builder) {
        jobs[`gate/${system_symbol}/1`] = {
            type: 'gate_builder',
            ship_type: 'SHIP_LIGHT_HAULER',
            params: { system_symbol, },
        }
    }

    stage_runner.data.spec.jobs = jobs

    // delete jobs in status, that are not in spec
    // !! disabled - don't unassign jobs
    // for (const job_id in stage_runner.data.status.jobs) {
    //     if (!(job_id in stage_runner.data.spec.jobs)) {
    //         delete stage_runner.data.status.jobs[job_id]
    //     }
    // }

    const ship_types = {
        SHIP_PROBE: {
            engine: 'ENGINE_IMPULSE_DRIVE_I', // 3
            frame: 'FRAME_PROBE',
            mounts: [],
        },
        SHIP_LIGHT_HAULER: {
            engine: 'ENGINE_ION_DRIVE_I', // 10
            frame: 'FRAME_LIGHT_FREIGHTER',
            mounts: ['MOUNT_TURRET_I'],
        },
        SHIP_COMMAND: {
            engine: 'ENGINE_ION_DRIVE_II', // 30
            frame: 'FRAME_FRIGATE',
            mounts: ['MOUNT_SENSOR_ARRAY_II', 'MOUNT_GAS_SIPHON_II', 'MOUNT_MINING_LASER_II', 'MOUNT_SURVEYOR_II'],
        },
        SHIP_MINING_DRONE: {
            engine: 'ENGINE_IMPULSE_DRIVE_I', // 3
            frame: 'FRAME_DRONE',
            mounts: ['MOUNT_MINING_LASER_I'],
        },
        SHIP_SIPHON_DRONE: {
            engine: 'ENGINE_IMPULSE_DRIVE_I', // 3
            frame: 'FRAME_DRONE',
            mounts: ['MOUNT_GAS_SIPHON_I'],
        },
        SHIP_EXPLORER: {
            engine: 'ENGINE_ION_DRIVE_II', // 30
            frame: 'FRAME_EXPLORER',
            mounts: ['MOUNT_SENSOR_ARRAY_II', 'MOUNT_GAS_SIPHON_II'],
        },
        SHIP_REFINING_FREIGHTER: {
            engine: 'ENGINE_ION_DRIVE_II', // 30
            frame: 'FRAME_HEAVY_FREIGHTER',
            mounts: ['MOUNT_TURRET_I', 'MOUNT_TURRET_I', 'MOUNT_MISSILE_LAUNCHER_I'],
        },
    }

    // it might be better to classify base ship type based on their engine + frame + modules
    // since those can't be changed
    const all_ships = Object.fromEntries(Object.keys(ship_types).map(x => [x, []]))
    for (const ship of Object.values(agent.ships)) {
        const type = Object.entries(ship_types).find(([type, spec]) => {
            const mounts = ship.mounts.map(m => m.symbol).sort()
            const expected_mounts = spec.mounts.sort()
            const mount_match = mounts.length == expected_mounts.length && mounts.every((value, index) => value === expected_mounts[index])
            return ship.frame.symbol == spec.frame && mount_match
        })
        if (!type) {
            throw new Error(`Unknown ship type: ${ship.symbol}`)
        }
        all_ships[type[0]].push(ship.symbol)
    }

    const unassigned_ships = {}
    for (const ship_type in ship_types) {
        unassigned_ships[ship_type] = all_ships[ship_type]
            .filter(s => !Object.values(stage_runner.data.status.jobs).some(j => j.ship == s))
    }
    const job_ids = Object.keys(stage_runner.data.spec.jobs).sort((a, b) => stage_runner.data.spec.jobs[b].priority - stage_runner.data.spec.jobs[a].priority)

    for (const job_id of job_ids) {
        const job = stage_runner.data.spec.jobs[job_id]
        if (!(job_id in stage_runner.data.status.jobs)) {
            stage_runner.data.status.jobs[job_id] = {}
        }
        const status = stage_runner.data.status.jobs[job_id]
        if (status?.ship) continue

        // shipyard_waypoints

        if (unassigned_ships[job.ship_type].length != 0) {
            console.log(`Assigning job ${job_id} to ${job.ship_type} ${unassigned_ships[job.ship_type][0]}`)
            status.ship = unassigned_ships[job.ship_type][0]
            unassigned_ships[job.ship_type].shift()
        } else {
            console.log(`No unassigned ${job.ship_type}. Trying to buy one`)
            if (!CONFIG.enable_buying_ships) {
                throw new Error(`No unassigned ${job.ship_type} and buying ships is disabled`)
            }

            try {
                // might not have enough credits, and might not be a ship at the shipyard
                const shipyards = shipyard_waypoints[job.ship_type].filter(shipyard => {
                    const is_ship_present = Object.values(agent.ships).some(ship => ship.nav.waypointSymbol == shipyard && ship.nav.status != 'IN_TRANSIT')
                    return is_ship_present
                })
                if (shipyards.length == 0) {
                    console.log(`No shipyards with ${job.ship_type} present`)
                    if (CONFIG.error_on_missing_ship) {
                        throw new Error(`Ship not present at shipyard, not buying`)
                    }
                    continue
                }

                const prices = await Promise.all(shipyards.map(async shipyard => {
                    const buyer_ship = Object.values(agent.ships).find(ship => ship.nav.waypointSymbol == shipyard && ship.nav.status != 'IN_TRANSIT')
                    const buyer_ship_controller = agent.ship_controller(buyer_ship.symbol)
                    const sy = await buyer_ship_controller.refresh_shipyard()
                    assert(sy)
                    await universe.save_local_shipyard(sy)
                    const purchase_price = sy.ships.find(s => s.type == job.ship_type).purchasePrice
                    return { shipyard, purchase_price }
                }))
                console.log(`${shipyards.length} shipyards with ${job.ship_type}: ${prices.map(x => `${x.shipyard} ${x.purchase_price}`).join(', ')}`)
                const shipyard = prices.sort((a, b) => a.purchase_price - b.purchase_price)[0].shipyard

                const ship = await agent.buy_ship(shipyard, job.ship_type)
                console.log(`Bought ${job.ship_type}: ${ship.symbol}`)
                status.ship = ship.symbol
            } catch (e) {
                console.log(`Error while buying ${job.ship_type}: ${e}`)
                if (CONFIG.error_on_missing_ship) {
                    throw e
                }
            }
        }
    }
    stage_runner.save()

    if (!CONFIG.enable_scripts)
        throw new Error('Not running scripts')

    // run scripts:
    const p = []
    for (const job_id in stage_runner.data.status.jobs) {
        const job = stage_runner.data.spec.jobs[job_id]
        const status = stage_runner.data.status.jobs[job_id]
        if (!status.ship) continue

        const ship = agent.ship_controller(status.ship)
        // console.log(`Running job ${job_id} for ship ${ship.symbol}`)
        if (job.type == 'idle_probe') {
            p.push(probe_idle_script(universe, ship, job.params))
        } else if (job.type == 'trading') {
            p.push(trading_script(universe, agent.agent, ship, job.params))
        } else if (job.type == 'supply_trading') {
            p.push(supply_chain_trader(universe, agent, ship))
        } else if (job.type == 'supply_trading_v2') {
            p.push(supply_chain_trader_v2(universe, agent, ship)) 
        } else if (job.type == 'fuel_trading') {
            p.push(fuel_trader(universe, agent, ship))
        } else if (job.type == 'gate_builder') {
            p.push(gate_builder_script(universe, agent.agent, ship, job.params))        
        } else if (job.type == 'contract') {
            p.push(contract_script(universe, agent, ship))
        } else if (job.type == 'market_probe_cycle') {
            p.push(market_probe_script(universe, ship, { system_symbol }))
        } else if (job.type == 'siphon_drone') {
            p.push(siphon_script(universe, agent, ship))
        } else if (job.type == 'cmd_extract') {
            p.push(cmd_extract_script(universe, agent, ship))
        }
        else {
            console.log(`Unknown job type ${job.type}`)
        }
    }

    if (callsign == 'WHYANDO') {
        // X1-JU88
        const probe_19 = agent.ship_controller('WHYANDO-19')
        p.push(market_probe_script(universe, probe_19, { system_symbol: 'X1-JU88' }))
        const hauler_1a = agent.ship_controller('WHYANDO-1A')
        p.push(trading_script(universe, agent.agent, hauler_1a, { system_symbol: 'X1-JU88' }))
        const hauler_1b = agent.ship_controller('WHYANDO-1B')
        p.push(trading_script(universe, agent.agent, hauler_1b, { system_symbol: 'X1-JU88' }))

        // X1-ZA74 (capital)
        const hauler_1c = agent.ship_controller('WHYANDO-1C')
        p.push(trading_script(universe, agent.agent, hauler_1c, { system_symbol: 'X1-ZA74' }))
        const probe_1d = agent.ship_controller('WHYANDO-1D')
        p.push(market_probe_script(universe, probe_1d, { system_symbol: 'X1-ZA74' }))
    }

    await Promise.all(p)
}

await main()
