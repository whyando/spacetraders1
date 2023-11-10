import fs from 'fs/promises'
import assert from 'assert'
import axios from 'axios'

import Ship from './ship.js'
import Agent from './agent.js'

const systems = JSON.parse(await fs.readFile('systems.json'), 'utf8')

const sys = (symbol) => {
    const arr = symbol.split('-')
    assert(arr.length == 3)
    return arr.slice(0, 2).join('-')
}

async function get_waypoint(waypoint_symbol) {
    const system_symbol = sys(waypoint_symbol)
    // check data directory first
    const data_path = `data/${system_symbol}/${waypoint_symbol}.json`
    if (await fs.access(data_path) == undefined) {
        return JSON.parse(await fs.readFile(data_path, 'utf8'))
    }
    throw new Error(`no waypoint data for ${waypoint_symbol}`)
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
    if (await fs.access(data_path) == undefined) {
        return JSON.parse(await fs.readFile(data_path, 'utf8'))
    }
    throw new Error(`no market data for ${waypoint_symbol}`)
    const url = `https://api.spacetraders.io/v2/systems/${system_symbol}/waypoints/${waypoint_symbol}/market`
    const response = await axios.get(url)
    const market = response.data.data
    // save to data directory
    fs.mkdirSync(`data/markets`, { recursive: true })
    fs.writeFileSync(data_path, JSON.stringify(market))
    return market
}


async function load_options() {
    const goods = {}
    for (const system of systems) {
        if (system.symbol == 'X1-MU21') {
            for (const w of system.waypoints) {
                const waypoint = await get_waypoint(w.symbol)
                const is_market = waypoint.traits.some(t => t.symbol == 'MARKETPLACE')
    
                if (!is_market) continue
    
                const market = await get_market(w.symbol)
                if (market.tradeGoods != undefined) {
                    // console.log(`${w.symbol}`)
                    for (const good of market.tradeGoods) {
                        const symbol = good.symbol.padEnd(20)
                        // console.log(`\t${symbol}\t$${good.purchasePrice}/$${good.sellPrice}\t${good.tradeVolume}\t${good.type}\t${good.activity}\t${good.supply}`)
    
                        if (goods[good.symbol] == undefined) {
                            goods[good.symbol] = []
                        } 
                        goods[good.symbol].push({ waypoint: w.symbol, ...good})
                    }
                }
            }
        }
    }

    const options = []

    for (const good in goods) {
        const buy_location = goods[good].sort((a, b) => a.purchasePrice - b.purchasePrice)[0]
        const sell_location = goods[good].sort((a, b) => b.sellPrice - a.sellPrice)[0]
        const profit = sell_location.sellPrice - buy_location.purchasePrice

        //if (good == 'PLATINUM')
        //    console.log(`${good}\t$${buy_location.purchasePrice}/$${sell_location.sellPrice} (${profit})\t${buy_location.waypoint}\t${sell_location.waypoint}`)
    
        options.push({ good: good, profit: profit, buy_location: buy_location, sell_location: sell_location })
    }
    options.sort((a, b) => b.profit - a.profit)
    
    options.forEach(o => {
        if (o.profit < 100) return
        console.log(`${o.good}\t$${o.profit}\t(${o.buy_location.waypoint} -> ${o.sell_location.waypoint})`)
    })
    
    return options.filter(o => o.profit >= 100)

}

await Agent.load('SPACETIRADER')
const ship = await Ship.new_fetch('SPACETIRADER-1')
await ship.flight_mode('CRUISE')
// await ship.navigate('X1-MU21-A1')
// await ship.wait_for_transit()
// await ship.refuel({maxFuelMissing: 1})

// await ship.jettison_all_cargo()
// console.log(`ship: ${JSON.stringify(ship._ship)}`)

console.log(`cargo: ${JSON.stringify(ship.cargo)}`)

while (true) {
    const mission = JSON.parse(await fs.readFile(`data/mission/${ship.symbol}`, 'utf8'))
    // const mission = { status: 'complete' }
    if (!mission) {
        console.log('no mission')
        break
    }

    if (mission.status == 'complete') {
        console.log('picking new mission')
        const options = await load_options()
        const target = options[0]
        if (!target) {
            console.log('no more markets to probe. sleeping for 1 minute')
            await new Promise(r => setTimeout(r, 60000))
            continue
        }
        console.log(`target: ${target.good}`)
        const expected_profit = target.profit * 35
        console.log(`expected profit: +$${expected_profit}`)
        const mission = { ...target, status: 'buy' }
        await fs.writeFile(`data/mission/${ship.symbol}`, JSON.stringify(mission,null,2))
    }
    else if (mission.status == 'buy') {
        await ship.refuel({maxFuelMissing: 50})
        await ship.navigate(mission.buy_location.waypoint)
        await ship.wait_for_transit()
        // await ship.refresh_market()
        while (ship.cargo.units < ship.cargo.capacity) {
            const quantity = Math.min(ship.cargo.capacity - ship.cargo.units, mission.buy_location.tradeVolume)
            await ship.buy_good(mission.good, quantity)
        }
        await ship.refresh_market()
        mission.status = 'sell'
        await fs.writeFile(`data/mission/${ship.symbol}`, JSON.stringify(mission,null,2))
    }
    else if (mission.status == 'sell') {
        await ship.refuel({maxFuelMissing: 50})
        await ship.navigate(mission.sell_location.waypoint)
        await ship.wait_for_transit()
        // await ship.refresh_market()
        while (ship.cargo.units > 0) {
            const quantity = Math.min(ship.cargo.units, mission.sell_location.tradeVolume)
            await ship.sell_good(mission.good, quantity)
        }
        await ship.refresh_market()
        mission.status = 'complete'
        await fs.writeFile(`data/mission/${ship.symbol}`, JSON.stringify(mission,null,2))
    } else {
        throw new Error(`unknown mission status: ${mission.status}`)
    }
}
