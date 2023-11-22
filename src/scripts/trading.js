import assert from 'assert'

import { sys } from '../util.js'
import Resource from '../resource.js'

const RESERVED_CREDITS = 20000

const target_buy_flow = (supply, trade_volume) => {
    if (supply == 'ABUNDANT') return 3 * trade_volume
    if (supply == 'HIGH') return 2 * trade_volume
    if (supply == 'MODERATE') return 1 * trade_volume
    if (supply == 'LIMITED') throw new Error('not buying limited')
    if (supply == 'SCARCE') throw new Error('not buying scarce')
    throw new Error(`unknown supply: ${supply}`)
}

const target_sell_flow = (supply, trade_volume) => {
    if (supply == 'ABUNDANT') throw new Error('not selling abundant')
    if (supply == 'HIGH') throw new Error('not selling high')
    if (supply == 'MODERATE') return 1 * trade_volume
    if (supply == 'LIMITED') return 2 * trade_volume
    if (supply == 'SCARCE') return 3 * trade_volume
    throw new Error(`unknown supply: ${supply}`)
}

const supply_map = {
    'ABUNDANT': 5,
    'HIGH': 4,
    'MODERATE': 3,
    'LIMITED': 2,
    'SCARCE': 1,
}

const should_buy = (good, market) => {
    assert(market.supply)
    return supply_map[market.supply] >= 3
}

export default async function trading_script(universe, agent, ship, { system_symbol }) {
    const market_shared_state = Resource.get(`data/market_shared/${system_symbol}.json`, {})
    const mission = Resource.get(`data/mission/${ship.symbol}.json`, { status: 'complete'})

    await ship.wait_for_transit()

    while (true) {
        if (mission.data.status == 'complete') {
            market_shared_state.data[ship.symbol] = []
            market_shared_state.save()
            console.log('picking new mission')
            // throw new Error('interrupt')
            if (ship.cargo.units > 0) {
                console.log('cargo:', JSON.stringify(ship.cargo))
                throw new Error('cargo not empty')
            }

            const options = await load_options(universe, ship.nav.waypointSymbol, ship.cargo.capacity)
            const filtered = options.filter(x => {
                const buy_key = `${x.buy_location.waypoint}/${x.good}` 
                const sell_key = `${x.sell_location.waypoint}/${x.good}`
                const buy_flow = Object.values(market_shared_state.data).map(x => x[buy_key] ?? 0).reduce((a, b) => a + b, 0)
                const sell_flow = Object.values(market_shared_state.data).map(x => x[sell_key] ?? 0).reduce((a, b) => a + b, 0)
                if (buy_flow - x.quantity < -1 * target_buy_flow(x.buy_location.supply, x.buy_location.tradeVolume)) {
                    console.log(`skipping ${x.good} due to existing buy flow: ${buy_flow}`)
                    return false
                }
                if (sell_flow + x.quantity > target_sell_flow(x.sell_location.supply, x.sell_location.tradeVolume)) {
                    console.log(`skipping ${x.good} due to existing sell flow: ${sell_flow}`)
                    return false
                }
                return true
            })
            console.log(`Filtered ${options.length} options down to ${filtered.length} options due to market locks`)
            const filtered2 = filtered.filter(x => should_buy(x.good, x.buy_location))
            console.log(`Filtered ${filtered.length} options down to ${filtered2.length} options due to supply`)

            const target = filtered2[0]
            if (!target) {
                console.log('no more profitable routes. sleeping for 5 minutes')
                await new Promise(r => setTimeout(r, 1000*60*5))
                continue
            }
            console.log(`target: ${target.good}`)
            const expected_profit = target.profit * ship.cargo.capacity
            console.log(`expected profit: +$${expected_profit}`)
            mission.data = { ...target, status: 'buy' }
            market_shared_state.data[ship.symbol] = {
                [`${target.buy_location.waypoint}/${target.good}`]: -target.quantity,
                [`${target.sell_location.waypoint}/${target.good}`]: target.quantity,
            }
            market_shared_state.save()
            mission.save()
        }
        else if (mission.data.status == 'buy') {
            const { good, quantity, buy_location, sell_location } = mission.data
        
            await ship.goto(buy_location.waypoint)
            await universe.save_local_market(await ship.refresh_market())

            while (quantity != ship.cargo.units) {
                const market = await universe.get_local_market(buy_location.waypoint)
                const { purchasePrice, supply, tradeVolume } = market.tradeGoods.find(g => g.symbol == good)
                if (purchasePrice != buy_location.purchasePrice) {
                    console.log(`warning: purchase price changed ${buy_location.purchasePrice} -> ${purchasePrice}`)
                    if (tradeVolume != buy_location.tradeVolume) {
                        console.log(`warning: trade volume changed ${buy_location.tradeVolume} -> ${tradeVolume}`)
                    }
                    if (purchasePrice > 0.5*(buy_location.purchasePrice + sell_location.sellPrice)) {
                        console.log('not buying anymore - price too high')
                        break
                    }
                    if (should_buy(good, { purchasePrice, supply }) == false) {
                        console.log(`not buying anymore - supply too low: ${supply}, ${purchasePrice}`)
                        break
                    }
                }
                console.log(`credits: $${agent.credits}`)
                const available_credits = agent.credits - RESERVED_CREDITS
                const units = Math.min(quantity - ship.cargo.units, tradeVolume, Math.floor(available_credits / purchasePrice))
                if (units <= 0) {
                    console.log(`couldnt fill up to target quantity ${ship.cargo.units}/${quantity}`)
                    break
                }
                const resp = await ship.buy_good(good, units)
                await universe.save_local_market(await ship.refresh_market())
                Object.assign(agent, resp.agent)
            }
            const holding = ship.cargo.inventory.find(g => g.symbol == good)?.units ?? 0
            if (holding <= 0) {
                market_shared_state.data[ship.symbol] = {}
                market_shared_state.save()
                console.log('warning: no cargo after buy... aborting mission')
                mission.data.status = 'complete'
                mission.save()
                continue
            }
            delete market_shared_state.data[ship.symbol][`${buy_location.waypoint}/${good}`]
            market_shared_state.save()
            mission.data.status = 'sell'
            mission.save()
        }
        else if (mission.data.status == 'sell') {
            const { good, sell_location } = mission.data

            await ship.goto(sell_location.waypoint)
            await universe.save_local_market(await ship.refresh_market())

            const market = await universe.get_local_market(sell_location.waypoint)
            const { purchasePrice, supply, tradeVolume } = market.tradeGoods.find(g => g.symbol == good)
            if (tradeVolume != sell_location.tradeVolume) {
                console.log(`warning: trade volume changed ${sell_location.tradeVolume} -> ${tradeVolume}`)
            }

            while (ship.cargo.units > 0) {
                const quantity = Math.min(ship.cargo.units, tradeVolume)
                const resp = await ship.sell_good(good, quantity)
                Object.assign(agent, resp.agent)
                await universe.save_local_market(await ship.refresh_market())
            }
            market_shared_state.data[ship.symbol] = {}
            market_shared_state.save()
            mission.data.status = 'complete'
            mission.save()
        } else {
            throw new Error(`unknown mission status: ${mission.status}`)
        }
    }
}

const load_options = async (universe, ship_location, cargo_size) => {
    const system = await universe.get_system(sys(ship_location))
    const current_waypoint = system.waypoints.find(w => w.symbol == ship_location)

    const goods = {}
    for (const w of system.waypoints) {
        const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
        if (!is_market) continue

        // load local market
        const distance = Math.round(Math.sqrt((w.x - current_waypoint.x)**2 + (w.y - current_waypoint.y)**2))
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
            if (supply_map[good.supply] >= 3) {
                if (goods[good.symbol].buy_price == null || purchasePrice < goods[good.symbol].buy_price) {
                    goods[good.symbol].buy_price = purchasePrice
                    goods[good.symbol].buy_waypoint = w.symbol
                    goods[good.symbol].buy_trade_volume = tradeVolume
                    goods[good.symbol].buy_activity = good.activity
                    goods[good.symbol].buy_supply = good.supply
                }
            }
            if (supply_map[good.supply] <= 3) {
                if (goods[good.symbol].sell_price == null || sellPrice > goods[good.symbol].sell_price) {
                    goods[good.symbol].sell_price = sellPrice
                    goods[good.symbol].sell_waypoint = w.symbol
                    goods[good.symbol].sell_trade_volume = tradeVolume
                    goods[good.symbol].sell_activity = good.activity
                    goods[good.symbol].sell_supply = good.supply
                }
            }
        }
    }
    // delete empty goods
    for (const [symbol, good] of Object.entries(goods)) {
        if (good.buy_price == null || good.sell_price == null) {
            delete goods[symbol]
        }
    }

    for (const [symbol, good] of Object.entries(goods)) {
        good.profit = good.sell_price - good.buy_price
    }
    const options = Object.entries(goods).sort((a, b) => b[1].profit - a[1].profit)
    options.filter(([symbol, good]) => good.profit > 0).map(([symbol, good]) => {
        console.log(`${symbol}\t+$${good.profit}\t$${good.buy_price}/$${good.sell_price}\t${good.buy_waypoint} -> ${good.sell_waypoint}`)
    })
    return options
        .filter(([symbol, good]) => good.profit >= 100)
        .map(([symbol, good]) => ({
            good: symbol,
            quantity: Math.min(
                target_buy_flow(good.buy_supply, good.buy_trade_volume),
                target_sell_flow(good.sell_supply, good.sell_trade_volume),
                cargo_size),
            profit: good.profit,
            buy_location: {
                waypoint: good.buy_waypoint,
                tradeVolume: good.buy_trade_volume,
                purchasePrice: good.buy_price,
                activity: good.buy_activity,
                supply: good.buy_supply,
            },
            sell_location: {
                waypoint: good.sell_waypoint,
                tradeVolume: good.sell_trade_volume,
                sellPrice: good.sell_price,
                activity: good.sell_activity,
                supply: good.sell_supply,
            },
        }))        
}
