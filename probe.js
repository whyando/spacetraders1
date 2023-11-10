import fs from 'fs'
import assert from 'assert'
import axios from 'axios'

import Ship from './ship.js'
import Agent from './agent.js'

const systems = JSON.parse(fs.readFileSync('systems.json'), 'utf8')

const sys = (symbol) => {
    const arr = symbol.split('-')
    assert(arr.length == 3)
    return arr.slice(0, 2).join('-')
}

async function get_waypoint(waypoint_symbol) {
    const system_symbol = sys(waypoint_symbol)
    // check data directory first
    const data_path = `data/${system_symbol}/${waypoint_symbol}.json`
    if (fs.existsSync(data_path)) {
        return JSON.parse(fs.readFileSync(data_path, 'utf8'))
    }
    const url = `https://api.spacetraders.io/v2/systems/${system_symbol}/waypoints/${waypoint_symbol}`
    const response = await axios.get(url)
    const waypoint = response.data.data
    // save to data directory
    fs.mkdirSync(`data/${system_symbol}`, { recursive: true })
    fs.writeFileSync(data_path, JSON.stringify(waypoint))
    return waypoint    
}

async function get_market(waypoint_symbol) {
    const system_symbol = sys(waypoint_symbol)
    // check data directory first
    const data_path = `data/markets/${waypoint_symbol}.json`
    if (fs.existsSync(data_path)) {
        return JSON.parse(fs.readFileSync(data_path, 'utf8'))
    }
    const url = `https://api.spacetraders.io/v2/systems/${system_symbol}/waypoints/${waypoint_symbol}/market`
    const response = await axios.get(url)
    const market = response.data.data
    // save to data directory
    fs.mkdirSync(`data/markets`, { recursive: true })
    fs.writeFileSync(data_path, JSON.stringify(market))
    return market
}




async function load_options(current_waypoint) {
    const ship_location = await get_waypoint(current_waypoint)

    const options = []
    for (const system of systems) {
        if (system.symbol == 'X1-MU21') {
            for (const w of system.waypoints) {
                const waypoint = await get_waypoint(w.symbol)
                const is_market = waypoint.traits.some(t => t.symbol == 'MARKETPLACE')
                if (!is_market) continue
                const market = await get_market(w.symbol)
                const prices_known = market.tradeGoods != undefined
                const timestamp = new Date(market.timestamp ?? 0)
    
                // if (prices_known) continue
                const dist = Math.round(Math.sqrt((w.x - ship_location.x)**2 + (w.y - ship_location.y)**2))
                // console.log(`${w.symbol}\t${w.type}\t(${w.x},${w.y})\t${prices_known}`)
    
                options.push({ market: w.symbol, distance: dist, price_known: prices_known, timestamp: timestamp })
            }
        }
    }
    const now = (new Date()).valueOf()
    const weight = (m) => {
        // more than 6 hours: distance only
        // less than 6 hours: recently updated markets are less important
        const age = (now - m.timestamp.valueOf()) / 1000 / 60 / 60
        if (age > 6) {
            return m.distance
        } else {
            return m.distance + (6 - age) * 250
        }
    }
    options.sort((a, b) => weight(a) - weight(b))
    options.map(o => {
        console.log(`${o.distance}\t${o.market}\t${o.price_known}\t${o.timestamp.toISOString()}\t${weight(o)}`)
    })

    return options
}

// probe: find closest market with unknown prices

await Agent.load('SPACETIRADER')
const probe = await Ship.new_fetch('SPACETIRADER-2')
console.log(`probe: ${JSON.stringify(probe._ship)}`)

while (true) {
    await probe.wait_for_transit()
    const options = await load_options(probe.nav.waypointSymbol)    
    const target = options[0]
    if (!target) {
        console.log('no more markets to probe')
        break
    }
    console.log(`target: ${target.market}`)

    await probe.flight_mode('BURN')
    await probe.navigate(target.market)
    await probe.wait_for_transit()
    await probe.refresh_market()
}
