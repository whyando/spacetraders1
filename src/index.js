import Agent from './agent.js'
import Universe from './universe.js'
import { sys } from './util.js'
import Resource from './resource.js'

import market_probe_script from './scripts/market_probe.js'
import trading_script from './scripts/trading.js'
import shipyard_probe_script from './scripts/shipyard_probe.js'
import probe_idle_script from './scripts/probe_idle.js'

async function main() {
    const agents = [
    {
        faction: 'COSMIC',
        callsign: 'AD-ASTRA',
    },
    {
        faction: 'COSMIC',
        callsign: 'WHYANDO',
    },
    {
        faction: 'COSMIC',
        callsign: 'THE-VOID',
    },
    {
        faction: 'COSMIC',
        callsign: 'ROQUE',
    }
    ]

    const universe = await Universe.load()

    await Promise.all(agents
        // .filter(x => x.callsign == 'AD-ASTRA')
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
    const stage_runner = await Resource.get(`data/stage_runner/${callsign}.json`, 
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
            waypoint,
            priority: waypoint == probe_shipyard ? 100 : 0,
        }
    }
    // todo: add trading jobs to spec
    stage_runner.data.spec.jobs = jobs

    // delete jobs in status, that are not in spec
    for (const job_id in stage_runner.data.status.jobs) {
        if (!(job_id in stage_runner.data.spec.jobs)) {
            delete stage_runner.data.status.jobs[job_id]
        }
    }

    const probes = Object.values(agent.ships).filter(s => s.frame.symbol == 'FRAME_PROBE').map(s => s.symbol)
    console.log(`Probes: ${probes.join(', ')}`)
    const unassigned_probes = probes.filter(s => !Object.values(stage_runner.data.status.jobs).some(j => j.ship == s))
    console.log(`Unassigned probes: ${unassigned_probes.join(', ')}`)

    const job_ids = Object.keys(stage_runner.data.spec.jobs).sort((a, b) => stage_runner.data.spec.jobs[b].priority - stage_runner.data.spec.jobs[a].priority)

    for (const job_id of job_ids) {
        const job = stage_runner.data.spec.jobs[job_id]
        if (!(job_id in stage_runner.data.status.jobs)) {
            stage_runner.data.status.jobs[job_id] = {}
        }
        const status = stage_runner.data.status.jobs[job_id]
        if (status?.ship) continue

        if (unassigned_probes.length != 0) {
            console.log(`Assigning job ${job_id} to probe ${unassigned_probes[0]}`)
            status.ship = unassigned_probes[0]
            unassigned_probes.shift()
        } else {
            console.log(`No unassigned probes. Trying to buy one`)
            try {
                // might not have enough credits, and might not be a ship at the shipyard
                const is_ship_present = Object.values(agent.ships).some(ship => ship.nav.waypointSymbol == probe_shipyard && ship.nav.status != 'IN_TRANSIT')
                if (!is_ship_present) {
                    console.log(`Ship not present at shipyard, not buying`)
                    continue
                }

                const probe = await agent.buy_ship(probe_shipyard, 'SHIP_PROBE')
                console.log(`Bought probe: ${probe.symbol}`)
                status.ship = probe.symbol
            } catch (e) {
                console.log(`Error while buying probe: ${e}`)
            }
        }
    }
    await stage_runner.save()
    
    const p = []
    for (const job_id in stage_runner.data.status.jobs) {
        const job = stage_runner.data.spec.jobs[job_id]
        const status = stage_runner.data.status.jobs[job_id]
        if (!status.ship) continue

        const ship = agent.ship_controller(status.ship)
        console.log(`Running job ${job_id} for ship ${ship.symbol}`)
        if (job.type == 'idle_probe') {
            p.push(probe_idle_script(universe, ship, { waypoint_symbol: job.waypoint }))
        }
    }

    // run scripts:
    const cmd_ship = agent.ship_controller(`${callsign}-1`)
    // const probe = agent.ship_controller(`${callsign}-2`)   
    // p.push(market_probe_script(universe, probe, { system_symbol }))
    // p.push(shipyard_probe_script(universe, probe, { system_symbol }))
    p.push(trading_script(universe, agent.agent, cmd_ship, { system_symbol }))
    await Promise.all(p)
}

await main()
