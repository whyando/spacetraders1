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

const LINEAR_CHAIN = ['LIQUID_NITROGEN', 'FERTILIZERS', 'FABRICS', 'CLOTHING']

export default async function supply_chain_trader(universe, agent, ship) {
    console.log('script supply_chain_trader', ship.symbol)

    const work_markets = await get_work_markets(universe, ship.nav.systemSymbol)
    console.log('work_markets', work_markets)
    for (let i = 1; i < LINEAR_CHAIN.length; i++) {
        assert.equal(work_markets[i].length, 1, `expected 1 market for ${LINEAR_CHAIN[i-1]} -> ${LINEAR_CHAIN[i]}`)
    }

    await ship.wait_for_transit()
    while (true) {
        await step(universe, agent, ship, { work_markets })
    }
}

async function step(universe, agent, ship, { work_markets }) {
    const market_shared_state = Resource.get(`data/market_shared/${ship.nav.systemSymbol}.json`, {})
    if (!market_shared_state.data[ship.symbol]) {
        market_shared_state.data[ship.symbol] = {}
        market_shared_state.save()
    }
    const mission = Resource.get(`data/mission/${ship.symbol}.json`, { status: 'complete', step: 0 })

    if (mission.data.status == 'complete') {
        for (let di = 1; di <= LINEAR_CHAIN.length; di++) {
            const step = (mission.data.step + di) % LINEAR_CHAIN.length
            console.log('picking new mission, step', step)
            const options = await load_options(universe, ship.nav.systemSymbol, work_markets, step)
            const buy = options.buy
                .filter(x => supply_map[x.supply] >= 3)
                .filter(x => !(x.symbol == 'CLOTHING' && x.activity == 'RESTRICTED' && supply_map[x.supply] <= 4)) // test: only buy clothing when not restricted + not moderate
            
            const sell = options.sell.filter(x => supply_map[x.supply] <= 3) // && x.activity != 'RESTRICTED')
            console.log(`After filters: ${buy.length} buy options, ${sell.length} sell options`)
            if (buy.length == 0 || sell.length == 0) {
                console.log(`failed to transfer ${LINEAR_CHAIN[step]}`)
                continue
            }
            // pick random buy and sell
            const buy_good = buy[Math.floor(Math.random() * buy.length)]
            const sell_good = sell[Math.floor(Math.random() * sell.length)]
            const quantity = Math.min(
                target_buy_flow(buy_good.supply, buy_good.tradeVolume),
                target_sell_flow(sell_good.supply, sell_good.tradeVolume),
                ship.cargo.capacity)
            
            // check flow condition
            const buy_key = `${buy_good.market}/${buy_good.symbol}`
            const sell_key = `${sell_good.market}/${sell_good.symbol}`
            const buy_flow = Object.values(market_shared_state.data).map(x => x[buy_key] ?? 0).reduce((a, b) => a + b, 0)
            const sell_flow = Object.values(market_shared_state.data).map(x => x[sell_key] ?? 0).reduce((a, b) => a + b, 0)
            if (buy_flow - quantity < -1 * target_buy_flow(buy_good.supply, buy_good.tradeVolume)) {
                console.log(`skipping ${buy_good.symbol} due to existing buy flow: ${buy_flow} at ${buy_good.market}`)
                continue
            }
            if (sell_flow + quantity > target_sell_flow(sell_good.supply, sell_good.tradeVolume)) {
                console.log(`skipping ${buy_good.symbol} due to existing sell flow: ${sell_flow} at ${sell_good.market}`)
                continue
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
        console.log('no viable supply chain routes. sleeping for 3 minutes')
        return await new Promise(r => setTimeout(r, 1000*60*3))
    }
    else if (mission.data.status == 'buy') {
        const { buy_good, sell_good, quantity } = mission.data

        await ship.goto(buy_good.market)
        await universe.save_local_market(await ship.refresh_market())

        while (quantity != ship.cargo.units) {
            const market = await universe.get_local_market(buy_good.market)
            const { purchasePrice, supply, tradeVolume, activity } = market.tradeGoods.find(g => g.symbol == buy_good.symbol)
            if (tradeVolume != buy_good.tradeVolume) {
                console.log(`warning: trade volume changed ${buy_good.tradeVolume} -> ${tradeVolume}`)
            }
            if (purchasePrice != buy_good.purchasePrice) {
                console.log(`warning: purchase price changed ${buy_good.purchasePrice} -> ${purchasePrice}`)
                if (purchasePrice > sell_good.sellPrice) {
                    console.log('not buying anymore - price too high')
                    break
                }
                if (supply_map[supply] < 3) {
                    console.log(`not buying anymore - supply too low: ${supply}`)
                    break
                }
            }
            if (buy_good.symbol == 'CLOTHING' && (activity == 'RESTRICTED' && supply_map[supply] <= 4)) {
                console.log('not buying anymore - clothing restricted')
                break
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
            mission.save()
            await new Promise(r => setTimeout(r, 1000*60))
            return
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

async function load_options(universe, system_symbol, work_markets, step) {
    const options = []
    const tradeSymbol = LINEAR_CHAIN[step]
    console.log(`Finding routes for ${step} ${tradeSymbol}`)

    const system = await universe.get_system(system_symbol)

    if (step == 0) {
        const sell_market = await universe.get_local_market(work_markets[step + 1][0].market)
        const sell_good = {
            market: sell_market.symbol,
            ...sell_market.tradeGoods.find(x => x.symbol == tradeSymbol)
        }
        const buy_goods = []
        for (const w of system.waypoints) {
            const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
            if (!is_market) continue    
            const market = await universe.get_local_market(w.symbol)
            if (!market) continue

            const good = market.tradeGoods.find(x => x.symbol == tradeSymbol)
            if (good && (good.type == 'EXPORT' || good.type == 'EXCHANGE')) {
                buy_goods.push({
                    market: w.symbol,
                    ...good,
                })
            }
        }
        return { buy: buy_goods, sell: [sell_good] }
    } else if (step < LINEAR_CHAIN.length - 1) {
        const buy_market = await universe.get_local_market(work_markets[step][0].market)
        const sell_market = await universe.get_local_market(work_markets[step + 1][0].market)
        const buy_good = {
            market: buy_market.symbol,
            ...buy_market.tradeGoods.find(x => x.symbol == tradeSymbol)
        }
        const sell_good = {
            market: sell_market.symbol,
            ...sell_market.tradeGoods.find(x => x.symbol == tradeSymbol)
        }
        return { buy: [buy_good], sell: [sell_good] }
    } else if (step == LINEAR_CHAIN.length - 1) {
        const buy_market = await universe.get_local_market(work_markets[step][0].market)
        const buy_good = {
            market: buy_market.symbol,
            ...buy_market.tradeGoods.find(x => x.symbol == tradeSymbol)
        }

        const sell_goods = []
        for (const w of system.waypoints) {
            const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
            if (!is_market) continue    
            const market = await universe.get_local_market(w.symbol)
            if (!market) continue

            const good = market.tradeGoods.find(x => x.symbol == tradeSymbol)
            if (good && (good.type == 'IMPORT' || good.type == 'EXCHANGE')) {
                sell_goods.push({
                    market: w.symbol,
                    ...good,
                })
            }
        }
        return { buy: [buy_good], sell: sell_goods }
    } else {
        throw new Error(`invalid step ${step}`)
    }
}


async function get_work_markets(universe, system_symbol) {
    const system = await universe.get_system(system_symbol)
    const work_markets = {}
    for (let i = 1; i < LINEAR_CHAIN.length; i++) {
        for (const w of system.waypoints) {
            const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
            if (!is_market) continue    
            const market = await universe.get_local_market(w.symbol)
            if (!market) continue
            
            const is_import = market.imports.some(x => x.symbol == LINEAR_CHAIN[i-1])
            const is_export = market.exports.some(x => x.symbol == LINEAR_CHAIN[i])
            if (!is_import || !is_export) continue
    
            console.log(`${LINEAR_CHAIN[i-1]} -> ${LINEAR_CHAIN[i]} at ${w.symbol}`)
            const import_good = market.tradeGoods.find(x => x.symbol == LINEAR_CHAIN[i-1])
            const export_good = market.tradeGoods.find(x => x.symbol == LINEAR_CHAIN[i])
            if (!work_markets[i]) work_markets[i] = []
            work_markets[i].push({
                market: w.symbol,
                import_good,
                export_good,
            })
        }
    }
    return work_markets
}

