import commandLineArgs from 'command-line-args'

import Agent from './agent.js'
import Universe from './universe.js'
import { sys } from './util.js'
import Resource from './resource.js'

import market_probe_script from './scripts/market_probe.js'
import trading_script from './scripts/trading.js'
import shipyard_probe_script from './scripts/shipyard_probe.js'
import probe_idle_script from './scripts/probe_idle.js'
import gate_builder_script from './scripts/gate_builder.js'
import contract_script from './scripts/contract.js'

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
                faction: 'COSMIC',
                callsign: x,
            }
        }
        const [faction, callsign] = x.split(':')
        return { faction, callsign }
    })

    const universe = await Universe.load()
    await Promise.all(agents
        .map(agent => run_agent(universe, agent))
    )
}

async function run_agent(universe, agent_config) {
    const { faction, callsign } = agent_config
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
    const probe_shipyard = shipyards.find(s => s.shipTypes.some(x => x.type == 'SHIP_PROBE')).symbol
    const hauler_shipyard = shipyards.find(s => s.shipTypes.some(x => x.type == 'SHIP_LIGHT_HAULER')).symbol    
    const shipyard_waypoints = {
        'SHIP_PROBE': probe_shipyard,
        'SHIP_LIGHT_HAULER': hauler_shipyard,
    }

    const stages = [{
        // stage A, until we hit 1M credits
        // starting probe cycles markets fetching prices
        // command ship runs trading script
        name: 'A',
        objective: {
            credits: 1_000_000,
        }
    }, {
        // stage B, until we hit 10M credits
        // starting probe idles at shipyard that sells probes
        // probes spread to all markets
        // probes spread to all shipyards
        // command ship runs trading script
        name: 'B',
        reserved_trading_credits: 500_000,
        objective: {
            credits: 10_000_000,
        }
    }, {
        // stage C, until we open the gate
        // probes at all markets
        // probes at all shipyards
        // x haulers trading
        // y haulers building gate
        name: 'C',
        reserved_trading_credits: 2_000_000,
        objective: {
            gate_open: true,
        }
    }, {
        // stage D
        // probe inter-system
        // trade inter-system
        name: 'D',
        reserved_trading_credits: 2_000_000,
    }]

    // async process: stage-runner
    // 1. establish which stage we're in
    //    current stage is in stored in stage-runner state, and increment only
    //    stage-runner state is always persisted
    // 2. buy ships as dictated by stage (and available credits)
    // 3. run individual ship scripts as dictated by stage
    // 4. watch for stage completion, and advance to next stage - may need to interrupt ship scripts?


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
    stage_runner.data.spec.stage = 'C'
    const probe_waypoints = new Set()
    for (const m of markets) {
        probe_waypoints.add(m.symbol)
    }
    for (const s of shipyards) {
        probe_waypoints.add(s.symbol)
    }
    const jobs = {}
    for (const waypoint of probe_waypoints) {
        const id = `idle_probe/${waypoint}`
        jobs[id] = {
            type: 'idle_probe',
            ship_type: 'SHIP_PROBE',
            params: {
                waypoint_symbol: waypoint,
            },
            priority: waypoint == probe_shipyard ? 100 : 50,
        }
    }
    for (let i = 1; i <= 5; i++) {
        jobs[`trading/${system_symbol}/${i}`] = {
            type: 'trading',
            ship_type: 'SHIP_LIGHT_HAULER',
            params: {
                system_symbol,
                market_index: i,
            },
            priority: 0,
        }
    }
    for (let i = 1; i <= 1; i++) {
        // if (callsign != 'WHYANDO') continue
        jobs[`gate/${system_symbol}/${i}`] = {
            type: 'gate_builder',
            ship_type: 'SHIP_LIGHT_HAULER',
            params: {
                system_symbol,
            },
            priority: 0,
        }
    }
    for (let i = 1; i <= 1; i++) {
        if (callsign != 'WHYANDO') continue
        jobs[`contract/${system_symbol}/${i}`] = {
            type: 'contract',
            ship_type: 'SHIP_COMMAND',
            params: {
                system_symbol,
            },
            priority: 0,
        }
    }

    stage_runner.data.spec.jobs = jobs

    // delete jobs in status, that are not in spec
    for (const job_id in stage_runner.data.status.jobs) {
        if (!(job_id in stage_runner.data.spec.jobs)) {
            delete stage_runner.data.status.jobs[job_id]
        }
    }

    const unassigned_ships = {}
    unassigned_ships['SHIP_PROBE'] = Object.values(agent.ships)
        .filter(s => s.frame.symbol == 'FRAME_PROBE')
        .map(s => s.symbol)
        .filter(s => !Object.values(stage_runner.data.status.jobs).some(j => j.ship == s))
    unassigned_ships['SHIP_LIGHT_HAULER'] = Object.values(agent.ships)
        .filter(s => s.frame.symbol == 'FRAME_LIGHT_FREIGHTER')
        .map(s => s.symbol)
        .filter(s => !Object.values(stage_runner.data.status.jobs).some(j => j.ship == s))
    unassigned_ships['SHIP_COMMAND'] = Object.values(agent.ships)
        .filter(s => s.frame.symbol == 'FRAME_FRIGATE')
        .map(s => s.symbol)
        .filter(s => !Object.values(stage_runner.data.status.jobs).some(j => j.ship == s))
    console.log(`Unassigned probes: ${unassigned_ships['SHIP_PROBE'].join(', ')}`)
    console.log(`Unassigned haulers: ${unassigned_ships['SHIP_LIGHT_HAULER'].join(', ')}`)
    console.log(`Unassigned command ships: ${unassigned_ships['SHIP_COMMAND'].join(', ')}`)

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
            if (job.ship_type == 'SHIP_COMMAND') {
                console.log(`Not buying command ships`)
                continue
            }
            try {
                // might not have enough credits, and might not be a ship at the shipyard
                const shipyard = shipyard_waypoints[job.ship_type]
                const is_ship_present = Object.values(agent.ships).some(ship => ship.nav.waypointSymbol == shipyard && ship.nav.status != 'IN_TRANSIT')
                if (!is_ship_present) {
                    console.log(`Ship not present at shipyard, not buying`)
                    continue
                }

                const ship = await agent.buy_ship(shipyard, job.ship_type)
                console.log(`Bought ${job.ship_type}: ${ship.symbol}`)
                status.ship = ship.symbol
            } catch (e) {
                console.log(`Error while buying ${job.ship_type}: ${e}`)
            }
        }
    }
    stage_runner.save()
    
    // run scripts:
    const p = []
    for (const job_id in stage_runner.data.status.jobs) {
        const job = stage_runner.data.spec.jobs[job_id]
        const status = stage_runner.data.status.jobs[job_id]
        if (!status.ship) continue

        const ship = agent.ship_controller(status.ship)
        console.log(`Running job ${job_id} for ship ${ship.symbol}`)
        if (job.type == 'idle_probe') {
            p.push(probe_idle_script(universe, ship, job.params))
        } else if (job.type == 'trading') {
            p.push(trading_script(universe, agent.agent, ship, job.params))
        } else if (job.type == 'gate_builder') {
            p.push(gate_builder_script(universe, agent.agent, ship, job.params))        
        } else if (job.type == 'contract') {
            p.push(contract_script(universe, agent, ship))
        } else  {
            console.log(`Unknown job type ${job.type}`)
        }
    }

    // const cmd_ship = agent.ship_controller(`${callsign}-1`)
    // p.push(trading_script(universe, agent.agent, cmd_ship, { system_symbol }))

    // const probe = agent.ship_controller(`${callsign}-2`)   
    // p.push(market_probe_script(universe, probe, { system_symbol }))
    // p.push(shipyard_probe_script(universe, probe, { system_symbol }))
    await Promise.all(p)
}

await main()
