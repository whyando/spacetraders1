import assert from 'assert'

import { sys } from '../util.js'
import Resource from '../resource.js'

const RESERVED_CREDITS = 20000

const target_buy_flow = (supply, trade_volume) => {
    if (supply == 'ABUNDANT') return 3 * trade_volume
    if (supply == 'HIGH') return 2 * trade_volume
    if (supply == 'MODERATE') return 1 * trade_volume
    if (supply == 'LIMITED') return 1 * trade_volume // throw new Error('not buying limited')
    if (supply == 'SCARCE') return 1 * trade_volume // throw new Error('not buying scarce')
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

export default async function fuel_trader(universe, agent, ship) {
    console.log('script fuel_trader', ship.symbol)

    await ship.wait_for_transit()
    while (true) {
        await step(universe, agent, ship)
    }
}

async function step(universe, agent, ship) {
    const market_shared_state = Resource.get(`data/market_shared/${ship.nav.systemSymbol}.json`, {})
    if (!market_shared_state.data[ship.symbol]) {
        market_shared_state.data[ship.symbol] = {}
        market_shared_state.save()
    }
    const mission = Resource.get(`data/mission/${ship.symbol}.json`, { status: 'complete', step: 0 })

    if (mission.data.status == 'complete') {
        console.log('picking new fuel mission')
        const trades = await load_trades(universe, ship.nav.systemSymbol, 'FUEL')

        // algorithm: try to distribute so that difference in purchasePrice stays within 50 credits
        let buy_good = null
        let sell_good = null
        for (const t of trades) {
            if (buy_good == null || t.purchasePrice < buy_good.purchasePrice) {
                buy_good = t
            }
            if (sell_good == null || t.purchasePrice > sell_good.purchasePrice) {
                sell_good = t
            }
        }
        assert(buy_good)
        assert(sell_good)

        console.log(`fuel min purchasePrice: ${buy_good.purchasePrice} at ${buy_good.market}`)
        console.log(`fuel max purchasePrice: ${sell_good.purchasePrice} at ${sell_good.market}`)
        if (sell_good.purchasePrice - buy_good.purchasePrice < 20) {
            console.log('fuel trader bypass - less than 20c difference')
            return await new Promise(r => setTimeout(r, 1000*60*3))
        }
        const quantity = ship.cargo.capacity            

        // if (min_sell_supply > 3) {
        //     console.log('fuel supply too high. sleeping for 3 minutes')
        //     return await new Promise(r => setTimeout(r, 1000*60*3))
        // }
        // if (max_buy_supply == min_sell_supply) {
        //     console.log('fuel supply uniform. sleeping for 3 minutes')
        //     return await new Promise(r => setTimeout(r, 1000*60*3))
        // }
        // const buy = options.buy.filter(x => supply_map[x.supply] == max_buy_supply)
        // const sell = options.sell.filter(x => supply_map[x.supply] == min_sell_supply)
        // console.log(`After filters: ${buy.length} buy options, ${sell.length} sell options`)
        // assert(buy.length > 0)
        // assert(sell.length > 0)
        
        // // prefer EXPORT for buy, otherwise random
        // // random for sell

        // // pick random buy and sell
        // let buy_good;
        // let export_buy_option = buy.find(x => x.type == 'EXPORT')
        // if (export_buy_option) {
        //     buy_good = export_buy_option
        // } else {
        //     buy_good = buy[Math.floor(Math.random() * buy.length)]
        // }
        // const sell_good = sell[Math.floor(Math.random() * sell.length)]
        // const quantity = Math.min(
        //     target_buy_flow(buy_good.supply, buy_good.tradeVolume),
        //     target_sell_flow(sell_good.supply, sell_good.tradeVolume),
        //     ship.cargo.capacity)
        
        // fueltrader bypasses flow conditions
        const buy_key = `${buy_good.market}/${buy_good.symbol}`
        const sell_key = `${sell_good.market}/${sell_good.symbol}`
        const buy_flow = Object.values(market_shared_state.data).map(x => x[buy_key] ?? 0).reduce((a, b) => a + b, 0)
        const sell_flow = Object.values(market_shared_state.data).map(x => x[sell_key] ?? 0).reduce((a, b) => a + b, 0)
        if (buy_flow - quantity < -1 * target_buy_flow(buy_good.supply, buy_good.tradeVolume)) {
            console.log(`would skip ${buy_good.symbol} due to existing buy flow: ${buy_flow} at ${buy_good.market}`)
            //continue
        }
        if (sell_flow + quantity > target_sell_flow(sell_good.supply, sell_good.tradeVolume)) {
            console.log(`would skip ${buy_good.symbol} due to existing sell flow: ${sell_flow} at ${sell_good.market}`)
            //continue
        }

        market_shared_state.data[ship.symbol] = {
            [buy_key]: -quantity,
            [sell_key]: quantity,
        }
        market_shared_state.save()
        mission.data = {
            status: 'buy',
            quantity,
            buy_good,
            sell_good,
            step: step,
        }
        return mission.save()
    }
    else if (mission.data.status == 'buy') {
        const { buy_good, sell_good, quantity } = mission.data

        await ship.goto(buy_good.market)
        await universe.save_local_market(await ship.refresh_market())

        while (quantity != ship.cargo.units) {
            const market = await universe.get_local_market(buy_good.market)
            const { purchasePrice, supply, tradeVolume } = market.tradeGoods.find(g => g.symbol == buy_good.symbol)
            if (tradeVolume != buy_good.tradeVolume) {
                console.log(`warning: trade volume changed ${buy_good.tradeVolume} -> ${tradeVolume}`)
            }
            if (purchasePrice != buy_good.purchasePrice) {
                console.log(`warning: purchase price changed ${buy_good.purchasePrice} -> ${purchasePrice}`)
                if (purchasePrice > sell_good.sellPrice) {
                    console.log('fuel trader bypass - not buying anymore - price too high')
                    // break
                }
                if (supply_map[supply] < 3) {
                    console.log(`fuel trader bypass - not buying anymore - supply too low: ${supply}`)
                    // break
                }
            }
            console.log('credits: ', agent.credits)
            const available_credits = agent.credits - RESERVED_CREDITS
            const units = Math.min(quantity - ship.cargo.units, tradeVolume, Math.floor(available_credits / purchasePrice))            
            if (units <= 0) {
                console.log(`couldnt fill up to target quantity ${ship.cargo.units}/${quantity}`)
                break
            }
            const resp = await ship.buy_good(buy_good.symbol, units)
            await universe.save_local_market(await ship.refresh_market())
            Object.assign(agent.agent, resp.agent)
        }
        const holding = ship.cargo.inventory.find(g => g.symbol == buy_good.symbol)?.units ?? 0
        if (holding <= 0) {
            console.log('warning: no cargo after buy... aborting mission')
            market_shared_state.data[ship.symbol] = {}
            market_shared_state.save()
            mission.data.status = 'complete'
            return mission.save()
        }
        delete market_shared_state.data[ship.symbol][`${buy_good.market}/${buy_good.symbol}`]
        market_shared_state.save()
        mission.data.status = 'sell'
        return mission.save()
    } else if (mission.data.status == 'sell') {
        const { sell_good } = mission.data

        await ship.goto(sell_good.market)
        await universe.save_local_market(await ship.refresh_market())

        while (ship.cargo.units > 0) {
            const market = await universe.get_local_market(sell_good.market)
            const { purchasePrice, supply, tradeVolume } = market.tradeGoods.find(g => g.symbol == sell_good.symbol)
            if (tradeVolume != sell_good.tradeVolume) {
                console.log(`warning: trade volume changed ${sell_good.tradeVolume} -> ${tradeVolume}`)
            }

            const quantity = Math.min(ship.cargo.units, tradeVolume)
            const resp = await ship.sell_good(sell_good.symbol, quantity)
            Object.assign(agent.agent, resp.agent)
            await universe.save_local_market(await ship.refresh_market())
        }
        market_shared_state.data[ship.symbol] = {}
        market_shared_state.save()
        mission.data.status = 'complete'
        return mission.save()
    } else {
        throw new Error(`unknown status: ${mission.data.status}`)
    }
}

async function load_trades(universe, system_symbol, tradeSymbol='FUEL') {
    console.log(`Finding routes for ${tradeSymbol}`)

    const system = await universe.get_system(system_symbol)
    const trades = []
    for (const w of system.waypoints) {
        const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
        if (!is_market) continue    
        const market = await universe.get_local_market(w.symbol)
        if (!market) continue

        const good = market.tradeGoods.find(x => x.symbol == tradeSymbol)
        if (good) {
            trades.push({
                market: w.symbol,
                ...good,
            })
        }
    }
    return trades
}
