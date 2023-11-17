import fs from 'fs/promises'
import { sys } from '../util.js'
import Resource from '../resource.js'

const RESERVED_CREDITS = 20000

const supply_map = {
    'ABUNDANT': 5,
    'HIGH': 4,
    'MODERATE': 3,
    'LIMITED': 2,
    'SCARCE': 1,
}

const should_buy = (good, market) => {
    return supply_map[market.supply] >= 3
}

export default async function trading_script(universe, agent, ship, { system_symbol }) {
    const market_shared_state = Resource.get(`data/market_shared/${system_symbol}.json`, {})
    const mission = Resource.get(`data/mission/${ship.symbol}.json`, { status: 'complete'})

    while (true) {
        if (mission.data.status == 'complete') {
            market_shared_state.data[ship.symbol] = []
            market_shared_state.save()
            console.log('picking new mission')
            if (ship.cargo.units > 0) {
                console.log('cargo:', JSON.stringify(ship.cargo))
                throw new Error('cargo not empty')
            }

            const options = await load_options(universe, ship.nav.waypointSymbol)
            const filtered = options.filter(x => {
                const buy_key = `buy/${x.buy_location.waypoint}/${x.good}` 
                const sell_key = `sell/${x.sell_location.waypoint}/${x.good}`
                const locks = Object.values(market_shared_state.data).flat()
                return !locks.includes(buy_key) && !locks.includes(sell_key)
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
            market_shared_state.data[ship.symbol] = [`buy/${target.buy_location.waypoint}/${target.good}`, `sell/${target.sell_location.waypoint}/${target.good}`]
            market_shared_state.save()
            mission.save()
        }
        else if (mission.data.status == 'buy') {
            const { good, buy_location, sell_location } = mission.data
        
            await ship.refuel({maxFuelMissing: 99})
            await ship.navigate(buy_location.waypoint)
            await ship.wait_for_transit()
            await universe.save_local_market(await ship.refresh_market())

            while (ship.cargo.units < ship.cargo.capacity) {
                const market = await universe.get_local_market(buy_location.waypoint)
                const { purchasePrice, supply } = market.tradeGoods.find(g => g.symbol == good)
                if (purchasePrice != buy_location.purchasePrice) {
                    console.log(`warning: purchase price changed ${buy_location.purchasePrice} -> ${purchasePrice}`)
                    // if (purchasePrice > 0.5*(buy_location.purchasePrice + sell_location.sellPrice)) {
                    //     console.log('not buying anymore - price too high')
                    //     break
                    // }
                    if (should_buy(good, { purchasePrice, supply }) == false) {
                        console.log(`not buying anymore - supply too low: ${supply}, ${purchasePrice}`)
                        break
                    }
                }
                console.log(`credits: $${agent.credits}`)
                const available_credits = agent.credits - RESERVED_CREDITS
                const quantity = Math.min(ship.cargo.capacity - ship.cargo.units, buy_location.tradeVolume, Math.floor(available_credits / purchasePrice))
                if (quantity <= 0) {
                    console.log('not enough credits to fill cargo')
                    break
                }
                const resp = await ship.buy_good(good, quantity)
                await universe.save_local_market(await ship.refresh_market())
                Object.assign(agent, resp.agent)
            }
            const holding = ship.cargo.inventory.find(g => g.symbol == good)?.units ?? 0
            if (holding <= 0) {
                console.log('warning: no cargo after buy... aborting mission')
                mission.status = 'complete'
                await fs.writeFile(`data/mission/${ship.symbol}`, JSON.stringify(mission,null,2))
                continue
            }
            market_shared_state.data[ship.symbol] = [`sell/${sell_location.waypoint}/${good}`]
            market_shared_state.save()
            mission.data.status = 'sell'
            mission.save()
        }
        else if (mission.data.status == 'sell') {
            const { good, sell_location } = mission.data

            await ship.refuel({maxFuelMissing: 99})
            await ship.navigate(sell_location.waypoint)
            await ship.wait_for_transit()
            await universe.save_local_market(await ship.refresh_market())
            while (ship.cargo.units > 0) {
                const quantity = Math.min(ship.cargo.units, sell_location.tradeVolume)
                const resp = await ship.sell_good(good, quantity)
                Object.assign(agent, resp.agent)
                await universe.save_local_market(await ship.refresh_market())
            }
            mission.data.status = 'complete'
            mission.save()            
            market_shared_state.data[ship.symbol] = []
            market_shared_state.save()
        } else {
            throw new Error(`unknown mission status: ${mission.status}`)
        }
    }
}

const load_options = async (universe, ship_location) => {
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
    for (const [symbol, good] of Object.entries(goods)) {
        good.profit = good.sell_price - good.buy_price
    }
    const options = Object.entries(goods).sort((a, b) => b[1].profit - a[1].profit)
    options.filter(([symbol, good]) => good.profit > 0).map(([symbol, good]) => {
        console.log(`${symbol}\t+$${good.profit}\t$${good.buy_price}/$${good.sell_price}\t${good.buy_waypoint} -> ${good.sell_waypoint}`)
    })
    return options
        .filter(([symbol, good]) => good.profit >= 1)
        .map(([symbol, good]) => ({
            good: symbol,
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
