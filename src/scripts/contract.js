
import assert from 'assert'
import Resource from '../resource.js'


async function load_good_info(universe, system_symbol, target_good) {
    const system = await universe.get_system(system_symbol)

    const goods = {}
    for (const w of system.waypoints) {
        const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
        if (!is_market) continue

        const market = await universe.get_local_market(w.symbol)
        if (!market) continue
        for (const good of market.tradeGoods) {
            if (!goods[good.symbol]) {
                goods[good.symbol] = {
                    // minimum price seen                    
                    buy_price: null,
                    buy_waypoint: null,
                    buy_trade_volume: null,
                    buy_activity: null,
                    buy_supply: null,
                    // maximum price seen
                    sell_price: null,
                    sell_waypoint: null,
                    sell_trade_volume: null,
                    sell_activity: null,
                    sell_supply: null,
                }
            }
            const { purchasePrice, sellPrice, tradeVolume } = good
            if (goods[good.symbol].buy_price == null || purchasePrice < goods[good.symbol].buy_price) {
                goods[good.symbol].buy_price = purchasePrice
                goods[good.symbol].buy_waypoint = w.symbol
                goods[good.symbol].buy_trade_volume = tradeVolume
                goods[good.symbol].buy_activity = good.activity
                goods[good.symbol].buy_supply = good.supply
            }
            if (goods[good.symbol].sell_price == null || sellPrice > goods[good.symbol].sell_price) {
                goods[good.symbol].sell_price = sellPrice
                goods[good.symbol].sell_waypoint = w.symbol
                goods[good.symbol].sell_trade_volume = tradeVolume
                goods[good.symbol].sell_activity = good.activity
                goods[good.symbol].sell_supply = good.supply
            }
        }
    }
    return goods[target_good]
}

export default async function contract_script(universe, agent, ship) {
    const system_symbol = ship.nav.systemSymbol
    const mission = Resource.get(`data/mission/${ship.symbol}.json`, { status: 'complete'})

    console.log('mission: ', JSON.stringify(mission,null,2))
    console.log('cargo: ', JSON.stringify(ship.cargo,null,2))

    while (true) {
        if (mission.data.status == 'complete') {
            const contract = await agent.get_active_contract()
            if (contract == undefined) {
                console.log('no contract')
                const HQ = agent.agent.headquarters
                await ship.refuel({maxFuelMissing: 50})
                await ship.navigate(HQ)
                await ship.wait_for_transit()
                const contract_upd = await ship.negotiate_contract()
                await agent.append_contract(contract_upd)
                mission.data = {
                    'type': 'deliver_trip',
                    'status': 'complete',
                    contract: contract_upd,
                }
                mission.save()
            }
            else if (contract.accepted == false) {  
                await agent.accept_contract(contract.id)
            }
            else if (contract.accepted == true && contract.fulfilled == false) {
                if (contract.terms.deliver[0].unitsFulfilled == contract.terms.deliver[0].unitsRequired) {                
                    await agent.fulfill_contract(contract.id)
                    mission.data = {
                        status: 'complete',
                    }
                    mission.save()
                    continue
                }
        
                console.log('picking new mission')
                const purchase_location = await load_good_info(universe, system_symbol, contract.terms.deliver[0].tradeSymbol)
                console.log('best purchase location: ' + JSON.stringify(purchase_location))
    
                const cost_per_unit = purchase_location.buy_price
                const required = contract.terms.deliver[0].unitsRequired
    
                const reward = contract.terms.payment.onAccepted + contract.terms.payment.onFulfilled
                console.log(`cost: ${cost_per_unit * required}`)
                console.log(`reward: ${reward}`)
                const profit = reward - (cost_per_unit * required)
                console.log(`profit: ${reward - (cost_per_unit * required)}`)
                assert(profit > -1000)
                assert(cost_per_unit * required < 20000)
                assert(false)
                mission.data = {
                    'type': 'deliver_trip',
                    'status': 'buy',
                    contract: contract,
                    buy_location: purchase_location,
                }
                mission.save()
            } else {
                throw new Error(`unknown contract status: ${contract.status}`)
            }
        }
        else if (mission.data.status == 'buy') {
            const { contract, buy_location } = mission.data

            await ship.refuel({maxFuelMissing: 50})
            await ship.navigate(mission.data.buy_location.buy_waypoint)
            await ship.wait_for_transit()
            await universe.save_local_market(await ship.refresh_market())

            const tradeSymbol = mission.data.contract.terms.deliver[0].tradeSymbol
            const remaining_to_buy = contract.terms.deliver[0].unitsRequired - contract.terms.deliver[0].unitsFulfilled - ship.cargo.units
            const target_load_quantity = Math.min(remaining_to_buy, ship.cargo.capacity)
            console.log(`target load quantity: ${target_load_quantity}`)
            while (ship.cargo.units < target_load_quantity) {
                const purchase_quantity = Math.min(target_load_quantity - ship.cargo.units, buy_location.buy_trade_volume)
                await ship.buy_good(tradeSymbol, purchase_quantity)
            }
            await universe.save_local_market(await ship.refresh_market())
            mission.data.status = 'deliver'
            mission.save()
        }
        else if (mission.data.status == 'deliver') {
            const { contract, buy_location } = mission.data

            await ship.refuel({maxFuelMissing: 50})
            const target_loc = contract.terms.deliver[0].destinationSymbol
            await ship.navigate(target_loc)
            await ship.wait_for_transit()
    
            const tradeSymbol = contract.terms.deliver[0].tradeSymbol
            const units = Math.min(contract.terms.deliver[0].unitsRequired, ship.cargo.units)
            const contract_upd = await ship.deliver_contract(contract.id, tradeSymbol, units)
            Object.assign(contract, contract_upd)
            await agent.update_contract(contract)
            mission.data.status = 'complete'
            mission.save()
        } else {
            throw new Error(`unknown mission status: ${mission.data.status}`)
        }
    }
}

