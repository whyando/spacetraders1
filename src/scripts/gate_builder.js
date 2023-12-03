import fs from 'fs/promises'
import { sys } from '../util.js'
import Resource from '../resource.js'

const RESERVED_CREDITS = 20000

// bugs: we are buying more materials than required by the construction, when another ship is en route to site
// fix is: add shared state for the construction site

const target_buy_flow = (supply, trade_volume) => {
    if (supply == 'ABUNDANT') return 3 * trade_volume
    if (supply == 'HIGH') return 2 * trade_volume
    if (supply == 'MODERATE') return 1 * trade_volume
    if (supply == 'LIMITED') throw new Error('not buying limited')
    if (supply == 'SCARCE') throw new Error('not buying scarce')
    throw new Error(`unknown supply: ${supply}`)
}

const supply_map = {
    'ABUNDANT': 5,
    'HIGH': 4,
    'MODERATE': 3,
    'LIMITED': 2,
    'SCARCE': 1,
}

// always buy below this price
const always_buy_price_map = {
    // 'FAB_MATS': 2500,
    'FAB_MATS': 0,
}

const should_buy = (good, market) => {
    return supply_map[market.supply] >= 4
        || market.purchasePrice <= (always_buy_price_map[good] ?? 0)
}

export default async function gate_builder_script(universe, agent, ship, { system_symbol }) {
    const market_shared_state = Resource.get(`data/market_shared/${system_symbol}.json`, {})
    const mission = Resource.get(`data/mission/${ship.symbol}.json`, { status: 'complete'})

    await ship.wait_for_transit()

    const system = await universe.get_system(system_symbol)
    const jump_gate_symbol = system.waypoints.find(w => w.type == 'JUMP_GATE').symbol
    // (todo: get up to date construction data)
    const construction = await universe.get_remote_construction(jump_gate_symbol)
    
    while (true) {
        if (mission.data.status == 'complete') {
            market_shared_state.data[ship.symbol] = {}
            market_shared_state.save()
            console.log('picking new mission')
            if (ship.cargo.units > 0) {
                console.log('cargo:', JSON.stringify(ship.cargo))
                throw new Error('cargo not empty')
            }

            const options = await load_options(universe, ship.nav.waypointSymbol, construction)
            options.sort((a, b) => supply_map[b.buy_location.supply] - supply_map[a.buy_location.supply])

            const filtered = options.filter(x => {
                const buy_key = `${x.buy_location.waypoint}/${x.good}` 
                // const sell_key = `${x.sell_location.waypoint}/${x.good}`
                const buy_flow = Object.values(market_shared_state.data).map(x => x[buy_key] ?? 0).reduce((a, b) => a + b, 0)
                // const sell_flow = Object.values(market_shared_state.data).map(x => x[sell_key] ?? 0).reduce((a, b) => a + b, 0)
                if (buy_flow - x.quantity < -1 * target_buy_flow(x.buy_location.supply, x.buy_location.tradeVolume)) {
                    console.log(`skipping ${x.good} due to existing buy flow: ${buy_flow}`)
                    return false
                }
                // if (sell_flow + x.quantity > target_sell_flow(x.sell_location.supply, x.sell_location.tradeVolume)) {
                //     console.log(`skipping ${x.good} due to existing sell flow: ${sell_flow}`)
                //     return false
                // }
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
            mission.data = { ...target, status: 'buy' }
            market_shared_state.data[ship.symbol] = {
                [`buy/${target.buy_location.waypoint}/${target.good}`]: -target.quantity,
            }
            market_shared_state.save()
            mission.save()
        }
        else if (mission.data.status == 'buy') {
            const { good, buy_location } = mission.data
        
            await ship.goto(buy_location.waypoint)
            await universe.save_local_market(await ship.refresh_market())

            while (ship.cargo.units < ship.cargo.capacity) {
                const market = await universe.get_local_market(buy_location.waypoint)
                const { purchasePrice, supply } = market.tradeGoods.find(g => g.symbol == good)
                if (purchasePrice != buy_location.purchasePrice) {
                    console.log(`warning: purchase price changed ${buy_location.purchasePrice} -> ${purchasePrice}`)
                }
                if (should_buy(good, { purchasePrice, supply }) == false) {
                    console.log(`not buying anymore - price too high / supply too low: ${supply}, ${purchasePrice}`)
                    break
                }
                console.log(`credits: $${agent.credits}`)
                const available_credits = agent.credits - RESERVED_CREDITS
                const construction_mat = construction.materials.find(x => x.tradeSymbol == good)
                const quantity = Math.min(
                    ship.cargo.capacity - ship.cargo.units,
                    buy_location.tradeVolume,
                    construction_mat.required - (construction_mat.fulfilled + ship.cargo.units),
                    Math.floor(available_credits / purchasePrice)
                )
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
                market_shared_state.data[ship.symbol] = {}
                market_shared_state.save()
                mission.data.status = 'complete'
                mission.save()
                await fs.writeFile(`data/mission/${ship.symbol}`, JSON.stringify(mission,null,2))                
                await new Promise(r => setTimeout(r, 1000*60))
                continue
            }
            market_shared_state.data[ship.symbol] = {}
            market_shared_state.save()
            mission.data.status = 'deliver'
            mission.save()
        }
        else if (mission.data.status == 'deliver') {
            const { good } = mission.data

            await ship.goto(jump_gate_symbol)
            while (ship.cargo.units > 0) {
                const c = await ship.supply_construction(jump_gate_symbol, good, ship.cargo.units)
                Object.assign(construction, c)
                await universe.save_remote_construction(construction)
            }
            mission.data.status = 'complete'
            mission.save()            
            market_shared_state.data[ship.symbol] = {}
            market_shared_state.save()
        } else {
            throw new Error(`unknown mission status: ${mission.status}`)
        }
    }
}

const load_options = async (universe, ship_location, construction) => {
    const system = await universe.get_system(sys(ship_location))
    const current_waypoint = system.waypoints.find(w => w.symbol == ship_location)

    const required_materials = construction.materials.filter(x => x.required != x.fulfilled)

    const goods = {}
    for (const w of system.waypoints) {
        const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
        if (!is_market) continue

        // load local market
        const _dist = Math.round(Math.sqrt((w.x - current_waypoint.x)**2 + (w.y - current_waypoint.y)**2))
        const market = await universe.get_local_market(w.symbol)
        if (!market) continue
        for (const good of market.tradeGoods) {
            if (!required_materials.some(x => x.tradeSymbol == good.symbol)) continue

            if (!goods[good.symbol]) {
                goods[good.symbol] = {
                    // minimum price seen                    
                    buy_price: null,
                    buy_waypoint: null,
                    buy_trade_volume: null,
                    buy_activity: null,
                    buy_supply: null,
                }
            }
            const { purchasePrice, tradeVolume } = good
            if (goods[good.symbol].buy_price == null || purchasePrice < goods[good.symbol].buy_price) {
                goods[good.symbol].buy_price = purchasePrice
                goods[good.symbol].buy_waypoint = w.symbol
                goods[good.symbol].buy_trade_volume = tradeVolume
                goods[good.symbol].buy_activity = good.activity
                goods[good.symbol].buy_supply = good.supply
            }
        }
    }
    const options = Object.entries(goods).sort((a, b) => b[1].profit - a[1].profit)
    console.log('construction materials:')
    options.map(([symbol, good]) => {
        console.log(`${symbol}\t$${good.buy_price}\t${good.buy_waypoint}\t${good.buy_trade_volume}\t${good.buy_activity}\t${good.buy_supply}`)
    })
    return options
        .map(([symbol, good]) => ({
            good: symbol,
            buy_location: {
                waypoint: good.buy_waypoint,
                tradeVolume: good.buy_trade_volume,
                purchasePrice: good.buy_price,
                activity: good.buy_activity,
                supply: good.buy_supply,                
            },
        }))
}
