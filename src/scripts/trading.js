import fs from 'fs/promises'
import { sys } from '../util.js'

export default async function trading_script(universe, agent, ship, { system_symbol }) {
    if (agent.symbol == 'DEVNULL') {
        console.log('DEVNULL: skipping trading script')
        return
    }
    console.log(agent.credits)
    
    while (true) {
        let mission_exists = false
        try {
            await fs.mkdir('data/mission', { recursive: true })
            await fs.access(`data/mission/${ship.symbol}.json`)
            mission_exists = true
        } catch (error) {}
        const mission = mission_exists && JSON.parse(await fs.readFile(`data/mission/${ship.symbol}.json`, 'utf8'))
        if (!mission || mission.status == 'complete') {
            console.log('picking new mission')
            const options = await load_options(universe, ship.nav.waypointSymbol)
            const target = options[0]
            if (!target) {
                console.log('no more profitable routes. sleeping for 5 minutes')
                await new Promise(r => setTimeout(r, 1000*60*5))
                continue
            }
            console.log(`target: ${target.good}`)
            const expected_profit = target.profit * 35
            console.log(`expected profit: +$${expected_profit}`)
            const mission = { ...target, status: 'buy' }
            await fs.writeFile(`data/mission/${ship.symbol}.json`, JSON.stringify(mission,null,2))
        }
        else if (mission.status == 'buy') {
            await ship.refuel({maxFuelMissing: 50})
            await ship.navigate(mission.buy_location.waypoint)
            await ship.wait_for_transit()
            // await ship.refresh_market()
            while (ship.cargo.units < ship.cargo.capacity) {
                const market = await universe.get_local_market(mission.buy_location.waypoint)
                const { purchasePrice } = market.tradeGoods.find(g => g.symbol == mission.good)
                if (purchasePrice != mission.buy_location.purchasePrice) {
                    console.log(`warning: purchase price changed ${mission.buy_location.purchasePrice} -> ${purchasePrice}`)
                    if (purchasePrice > 0.5*(mission.buy_location.purchasePrice + mission.sell_location.sellPrice)) {
                        console.log('not buying anymore - price too high')
                        break
                    }
                }
                console.log(`credits: $${agent.credits}`)
                const available_credits = agent.credits - 20000
                const quantity = Math.min(ship.cargo.capacity - ship.cargo.units, mission.buy_location.tradeVolume, Math.floor(available_credits / purchasePrice))
                if (quantity <= 0) {
                    console.log('not enough credits to fill cargo')
                    break
                }
                const resp = await ship.buy_good(mission.good, quantity)
                await universe.save_local_market(await ship.refresh_market())
                Object.assign(agent, resp.agent)
            }
            const holding = ship.cargo.inventory.find(g => g.symbol == mission.good)?.units ?? 0
            if (holding <= 0) {
                console.log('warning: no cargo after buy... aborting mission')
                mission.status = 'complete'
                await fs.writeFile(`data/mission/${ship.symbol}.json`, JSON.stringify(mission,null,2))
                continue
            }
            mission.status = 'sell'
            await fs.writeFile(`data/mission/${ship.symbol}.json`, JSON.stringify(mission,null,2))
        }
        else if (mission.status == 'sell') {
            await ship.refuel({maxFuelMissing: 50})
            await ship.navigate(mission.sell_location.waypoint)
            await ship.wait_for_transit()
            // await ship.refresh_market()
            while (ship.cargo.units > 0) {
                const quantity = Math.min(ship.cargo.units, mission.sell_location.tradeVolume)
                const resp = await ship.sell_good(mission.good, quantity)
                Object.assign(agent, resp.agent)
            }
            await universe.save_local_market(await ship.refresh_market())
            mission.status = 'complete'
            await fs.writeFile(`data/mission/${ship.symbol}.json`, JSON.stringify(mission,null,2))
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
        // if (!market.tradeGoods) {
        //     console.log(`warning: no trade goods at ${w.symbol}`)
        //     await fs.rm(`./data/local_market/${w.symbol}.json`)
        //     // continue
        // }
        for (const good of market.tradeGoods) {
            if (!goods[good.symbol]) {
                goods[good.symbol] = {
                    // minimum price seen                    
                    buy_price: null,
                    buy_waypoint: null,
                    buy_trade_volume: null,
                    // (supply, activity)
                    // maximum price seen
                    sell_price: null,
                    sell_waypoint: null,
                    sell_trade_volume: null,
                }
            }
            const { purchasePrice, sellPrice, tradeVolume } = good
            if (goods[good.symbol].buy_price == null || purchasePrice < goods[good.symbol].buy_price) {
                goods[good.symbol].buy_price = purchasePrice
                goods[good.symbol].buy_waypoint = w.symbol
                goods[good.symbol].buy_trade_volume = tradeVolume
            }
            if (goods[good.symbol].sell_price == null || sellPrice > goods[good.symbol].sell_price) {
                goods[good.symbol].sell_price = sellPrice
                goods[good.symbol].sell_waypoint = w.symbol
                goods[good.symbol].sell_trade_volume = tradeVolume
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
        .filter(([symbol, good]) => good.profit >= 100)
        .map(([symbol, good]) => ({
            good: symbol,
            profit: good.profit,
            buy_location: {
                waypoint: good.buy_waypoint,
                tradeVolume: good.buy_trade_volume,
                purchasePrice: good.buy_price,
            },
            sell_location: {
                waypoint: good.sell_waypoint,
                tradeVolume: good.sell_trade_volume,
                sellPrice: good.sell_price,
            },
        }))
}
