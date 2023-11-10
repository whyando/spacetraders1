import axios from 'axios'
import fs from 'fs/promises'
import assert from 'assert'

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
}

async function get_market(waypoint_symbol) {
    const system_symbol = sys(waypoint_symbol)
    // check data directory first
    const data_path = `data/markets/${waypoint_symbol}.json`
    if (await fs.access(data_path) == undefined) {
        return JSON.parse(await fs.readFile(data_path, 'utf8'))
    }
    throw new Error(`no market data for ${waypoint_symbol}`)
}

async function get_contract() {
    const SPACETRADERS_TOKEN = (await fs.readFile('token.txt', 'utf8')).trim()
    axios.defaults.headers.common['Authorization'] = `Bearer ${SPACETRADERS_TOKEN}`
    
    const uri = 'https://api.spacetraders.io/v2/my/contracts'
    const resp = await axios.get(uri)
    console.log(JSON.stringify(resp.data.data))
    const contract = resp.data.data.filter(c => c.fulfilled == false)[0]
    return contract
}

await Agent.load('SPACETIRADER')
const ship = await Ship.new_fetch('SPACETIRADER-1')
console.log(`ship: ${JSON.stringify(ship.ship)}`)

console.log(`cargo: ${JSON.stringify(ship.cargo)}`)

// contract states: not accepted, active, complete

async function load_good_info(target_good) {
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

    return goods[target_good]
}

while (true) {
    const mission = JSON.parse(await fs.readFile(`data/mission/${ship.symbol}`, 'utf8'))
    if (!mission) {
        console.log('no mission')
        break
    }

    if (mission.status == 'complete') {
        const contract = await get_contract()
        if (contract == undefined) {
            console.log('no contract')
            const HQ = 'X1-MU21-A1'
            await ship.refuel({maxFuelMissing: 50})
            await ship.navigate(HQ)
            await ship.wait_for_transit()
            const c = await ship.negotiate_contract()
            const mission = {
                'type': 'deliver_trip',
                'status': 'complete',
                contract: c,
            }
            await fs.writeFile(`data/mission/${ship.symbol}`, JSON.stringify(mission,null,2))
            continue
        }
        else if (contract.accepted == false) {        
            console.log('accepting contract')
            const uri = `https://api.spacetraders.io/v2/my/contracts/${contract.id}/accept`
            const resp = await axios.post(uri, {})        
            const { contract: contract_upd, agent } = resp.data.data
            Object.assign(contract, resp.data.data.contract)
        }
        else if (contract.accepted == true && contract.fulfilled == false) {
            if (contract.terms.deliver[0].unitsFulfilled == contract.terms.deliver[0].unitsRequired) {                
                console.log('fulfilling contract')
                const uri = `https://api.spacetraders.io/v2/my/contracts/${contract.id}/fulfill`
                const resp = await axios.post(uri, {})
                const { contract: contract_upd, agent } = resp.data.data

                mission.status = 'complete'
                mission.contract = contract_upd
                await fs.writeFile(`data/mission/${ship.symbol}`, JSON.stringify(mission,null,2))
                continue
            }
    
            console.log('picking new mission')
            const info = await load_good_info(contract.terms.deliver[0].tradeSymbol)
            const purchase_location = info.sort((a, b) => a.purchasePrice - b.purchasePrice)[0]
            console.log('best purchase location: ' + JSON.stringify(purchase_location))

            const cost_per_unit = purchase_location.purchasePrice
            const required = contract.terms.deliver[0].unitsRequired

            const reward = contract.terms.payment.onAccepted + contract.terms.payment.onFulfilled
            console.log(`cost: ${cost_per_unit * required}`)
            console.log(`reward: ${reward}`)
            const profit = reward - (cost_per_unit * required)
            console.log(`profit: ${reward - (cost_per_unit * required)}`)
            assert(profit > -10000)
            {
                const mission = {
                    'type': 'deliver_trip',
                    'status': 'buy',
                    contract: contract,
                    buy_location: purchase_location,
                }
                await fs.writeFile(`data/mission/${ship.symbol}`, JSON.stringify(mission,null,2))
            }
        } else {
            throw new Error(`unknown contract status: ${contract.status}`)
        }
    }
    else if (mission.status == 'buy') {await ship.refuel({maxFuelMissing: 50})
        await ship.navigate(mission.buy_location.waypoint)
        await ship.wait_for_transit()
        // await ship.refresh_market()
        const remaining_to_buy = mission.contract.terms.deliver[0].unitsRequired - mission.contract.terms.deliver[0].unitsFulfilled - ship.cargo.units
        const target_load_quantity = Math.min(remaining_to_buy, ship.cargo.capacity)
        console.log(`target load quantity: ${target_load_quantity}`)
        while (ship.cargo.units < target_load_quantity) {
            const purchase_quantity = Math.min(target_load_quantity - ship.cargo.units, mission.buy_location.tradeVolume)
            await ship.buy_good(mission.buy_location.symbol, purchase_quantity)
        }
        await ship.refresh_market()
        mission.status = 'deliver'
        // mission.contract = contract
        await fs.writeFile(`data/mission/${ship.symbol}`, JSON.stringify(mission,null,2))
    }
    else if (mission.status == 'deliver') {
        await ship.refuel({maxFuelMissing: 50})
        const target_loc = mission.contract.terms.deliver[0].destinationSymbol
        await ship.navigate(target_loc)
        await ship.wait_for_transit()

        const tradeSymbol = mission.contract.terms.deliver[0].tradeSymbol
        const units = Math.min(mission.contract.terms.deliver[0].unitsRequired, ship.cargo.units)
        const contract_upd = await ship.deliver_contract(mission.contract.id, tradeSymbol, units)

        mission.status = 'complete'
        mission.contract = contract_upd
        await fs.writeFile(`data/mission/${ship.symbol}`, JSON.stringify(mission,null,2))
    } else {
        throw new Error(`unknown mission status: ${mission.status}`)
    }
}
