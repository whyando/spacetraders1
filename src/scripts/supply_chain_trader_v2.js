import assert from 'assert'
import Resource from '../resource.js'
import Agent from '../agent.js'
import Universe from '../universe.js'
import DB from '../database.js'

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

const should_buy_good = (good) => {
    const { activity, supply, purchasePrice, tradeVolume, symbol, type } = good
    assert(supply)
    assert(purchasePrice)
    assert(tradeVolume)
    assert(symbol)
    assert(type)
    if (type == 'EXCHANGE') {
        return supply_map[supply] >= 3
    }
    assert(activity)
    if (type == 'IMPORT') throw new Error('not buying from import')
    if (activity == 'STRONG') {
        return supply_map[supply] >= 4
    }
    if (activity == 'GROWING' || activity == 'WEAK' || activity == 'RESTRICTED') {
        return supply_map[supply] >= 3
    }
    throw new Error(`unknown activity: ${activity}`)
}

const RECIPES = {
    'IRON': ['IRON_ORE'],
    'FAB_MATS': ['IRON', 'QUARTZ_SAND'],
}

// movements:
const MOVEMENTS = [
    {
        symbol: 'IRON_ORE',
        from: '*',
        to: 'IRON',
    },
    {
        symbol: 'IRON',
        from: 'IRON',
        to: 'FAB_MATS',
    },
    {
        symbol: 'QUARTZ_SAND',
        from: '*',
        to: 'FAB_MATS',
    },
]

// iron ore: * -> iron_market
// iron: iron_market -> fabmat_market
// quartz sand: * -> fabmat_market
// fabmat: fabmat_market -> * (skip)

export default async function supply_chain_trader_v2(universe, agent, ship) {
    console.log('script supply_chain_trader_v2', ship.symbol)


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
        for (let di = 1; di <= MOVEMENTS.length; di++) {
            const step = (mission.data.step + di) % MOVEMENTS.length
            console.log('picking new mission, step', step)
            const options = await load_options(universe, ship.nav.systemSymbol, step)
            const buy = options.buy
                .filter(x => should_buy_good(x))            
            const sell = options.sell.filter(x => supply_map[x.supply] <= 3)
            console.log(`After filters: ${buy.length} buy options, ${sell.length} sell options`)
            if (buy.length == 0 || sell.length == 0) {
                console.log(`failed to transfer ${MOVEMENTS[step].symbol}`)
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
        console.log('no viable supply chain v2 routes. sleeping for 3 minutes')
        return await new Promise(r => setTimeout(r, 1000*60*3))
    }
    else if (mission.data.status == 'buy') {
        const { buy_good, sell_good, quantity } = mission.data

        await ship.goto(buy_good.market)
        await universe.save_local_market(await ship.refresh_market())

        while (quantity != ship.cargo.units) {
            const market = await universe.get_local_market(buy_good.market)
            const good1 = market.tradeGoods.find(g => g.symbol == buy_good.symbol)
            const { purchasePrice, supply, tradeVolume, activity } = good1
            if (tradeVolume != buy_good.tradeVolume) {
                console.log(`warning: trade volume changed ${buy_good.tradeVolume} -> ${tradeVolume}`)
            }
            if (purchasePrice != buy_good.purchasePrice) {
                console.log(`warning: purchase price changed ${buy_good.purchasePrice} -> ${purchasePrice}`)
                if (purchasePrice > sell_good.sellPrice) {
                    console.log('not buying anymore - price too high')
                    break
                }
            }
            if (!should_buy_good(good1)) {
                console.log('not buying anymore - supply too low')
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

async function load_options(universe, system_symbol, step) {
    const { symbol: tradeSymbol, from, to } = MOVEMENTS[step]
    console.log(`Finding routes for ${step} ${tradeSymbol}`)
    
    const buy_goods = []
    if (from == '*') {
        const export_markets = await filter_waypoints(universe, system_symbol, { exports: tradeSymbol })
        const exchange_markets = await filter_waypoints(universe, system_symbol, { exchanges: tradeSymbol })
        for (const w of [...export_markets, ...exchange_markets]) {
            const market = await universe.get_local_market(w.symbol)
            const good = market.tradeGoods.find(x => x.symbol == tradeSymbol)
            assert(good)
            buy_goods.push({
                market: market.symbol,
                ...good,
            })
        }
    } else {
        const recipe_ingredients = RECIPES[from]
        const work_market = await filter_waypoints(universe, system_symbol, { imports: recipe_ingredients, exports: from, assert_one: true })
        const market = await universe.get_local_market(work_market.symbol)
        const good = market.tradeGoods.find(x => x.symbol == tradeSymbol)
        assert(good)
        buy_goods.push({
            market: market.symbol,
            ...good,
        })
    }

    const sell_goods = []
    if (to == '*') {
        const import_markets = await filter_waypoints(universe, system_symbol, { imports: tradeSymbol })
        const exchange_markets = await filter_waypoints(universe, system_symbol, { exchanges: tradeSymbol })
        for (const w of [...import_markets, ...exchange_markets]) {
            const market = await universe.get_local_market(w.symbol)
            const good = market.tradeGoods.find(x => x.symbol == tradeSymbol)
            assert(good)
            sell_goods.push({
                market: market.symbol,
                ...good,
            })
        }
    } else {
        const recipe_ingredients = RECIPES[to]
        const work_market = await filter_waypoints(universe, system_symbol, { imports: recipe_ingredients, exports: to, assert_one: true })
        const market = await universe.get_local_market(work_market.symbol)
        const good = market.tradeGoods.find(x => x.symbol == tradeSymbol)
        assert(good)
        sell_goods.push({
            market: market.symbol,
            ...good,
        })
    }

    return { buy: buy_goods, sell: sell_goods }    
}


async function filter_waypoints(universe, system_symbol, { type, imports, exports, exchanges, assert_one } = { assert_one: false }) {
    const system = await universe.get_system(system_symbol)
    const filtered = []
    imports = imports !== undefined ? (Array.isArray(imports) ? imports : [imports]) : []
    exports = exports !== undefined ? (Array.isArray(exports) ? exports : [exports]) : []
    exchanges = exchanges !== undefined ? (Array.isArray(exchanges) ? exchanges : [exchanges]) : []
    for (const w of system.waypoints) {
        const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
        if (type !== undefined && w.type != type) continue

        if (imports.length > 0 || exports.length > 0 || exchanges.length > 0) {
            if (!is_market) continue
            const market = await universe.get_remote_market(w.symbol)
            const market_imports = market.imports.map(x => x.symbol)
            const market_exports = market.exports.map(x => x.symbol)
            const market_exchanges = market.exchange.map(x => x.symbol)
            let match = true
            for (const good of imports) {
                if (!market_imports.includes(good)) {
                    match = false
                }
            }
            for (const good of exports) {
                if (!market_exports.includes(good)) {
                    match = false
                }
            }
            for (const good of exchanges) {
                if (!market_exchanges.includes(good)) {
                    match = false
                }
            }
            if (!match) continue
        }
        filtered.push(w)
    }
    if (assert_one) {
        assert.equal(filtered.length, 1)
        return filtered[0]
    }
    return filtered
}

if (import.meta.url == `file://${process.argv[1]}`) {
    const AGENT = process.argv[2]
    const SHIP_ID = process.argv[3] ?? '1'
    await DB.init()
    const universe = await Universe.load()
    const agent = await Agent.load(universe, null, AGENT)
    const ship = agent.ship_controller(`${AGENT}-${SHIP_ID}`)

    await supply_chain_trader_v2(universe, agent, ship)
}
