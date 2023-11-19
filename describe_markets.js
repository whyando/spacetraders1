import Universe from './src/universe.js'

const universe = await Universe.load()

const system_symbol = 'X1-DM98'
const system = await universe.get_system(system_symbol)

const goods = {}
const exports = []
const imports = []
const exchanges = []
for (const w of system.waypoints) {
    const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
    if (!is_market) continue

    // load local market
    const market = await universe.get_local_market(w.symbol)
    if (!market) continue
    if (!market.tradeGoods) {
        throw new Error(`no trade goods at ${w.symbol}`)
    }
    for (const good of market.tradeGoods) {
        // console.log(`${w.symbol}\t${good.symbol}\t$${good.purchasePrice}\t$${good.sellPrice}\t${good.tradeVolume}`)
        const trade = {
            market: w.symbol,
            ...good
        }
        // delete trade['type']
        if (good.type == 'IMPORT') {
            imports.push(trade)
            delete trade['purchasePrice']
        }
        else if (good.type == 'EXPORT') {
            exports.push(trade)
            delete trade['sellPrice']
        }
        else if (good.type == 'EXCHANGE')
            exchanges.push(trade)
        else
            throw new Error(`unknown trade type ${good.type}`)

        if (!goods[good.symbol]) {
            goods[good.symbol] = []
        }
        goods[good.symbol].push(trade)

        // if (!goods[good.symbol]) {
        //     goods[good.symbol] = {
        //         // minimum price seen                    
        //         buy_price: null,
        //         buy_waypoint: null,
        //         buy_trade_volume: null,
        //         // (supply, activity)
        //         // maximum price seen
        //         sell_price: null,
        //         sell_waypoint: null,
        //         sell_trade_volume: null,
        //     }
        // }
        // const { purchasePrice, sellPrice, tradeVolume } = good
        // if (goods[good.symbol].buy_price == null || purchasePrice < goods[good.symbol].buy_price) {
        //     goods[good.symbol].buy_price = purchasePrice
        //     goods[good.symbol].buy_waypoint = w.symbol
        //     goods[good.symbol].buy_trade_volume = tradeVolume
        // }
        // if (goods[good.symbol].sell_price == null || sellPrice > goods[good.symbol].sell_price) {
        //     goods[good.symbol].sell_price = sellPrice
        //     goods[good.symbol].sell_waypoint = w.symbol
        //     goods[good.symbol].sell_trade_volume = tradeVolume
        // }
    }
}

const type_map = {
    EXPORT: 1,
    IMPORT: 2,
    EXCHANGE: 3,
}

// for (const [symbol, trades] of Object.entries(goods)) {
//     trades.sort((a, b) => type_map[a.type] - type_map[b.type])
//     console.log(`${symbol}:`)
//     console.table(trades, ['market', 'tradeVolume', 'type', 'supply', 'activity', 'purchasePrice', 'sellPrice'])
// }

const linear_chain = ['LIQUID_NITROGEN', 'FERTILIZERS', 'FABRICS', 'CLOTHING']

for (let i = 1; i < linear_chain.length; i++) {
    for (const w of system.waypoints) {
        const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
        if (!is_market) continue    
        const market = await universe.get_local_market(w.symbol)
        if (!market) continue
        if (!market.tradeGoods)
            throw new Error(`no trade goods at ${w.symbol}`)
        
        const is_import = market.imports.some(x => x.symbol == linear_chain[i-1])
        const is_export = market.exports.some(x => x.symbol == linear_chain[i])
        if (!is_import || !is_export) continue

        console.log(`${linear_chain[i-1]} -> ${linear_chain[i]} at ${w.symbol}`)
        const import_good = {
            market: w.symbol,
            ...market.tradeGoods.find(x => x.symbol == linear_chain[i-1])
        }
        const export_good = {
            market: w.symbol,
            ...market.tradeGoods.find(x => x.symbol == linear_chain[i])
        }
        delete import_good['purchasePrice']
        delete export_good['sellPrice']

        console.table([import_good, export_good], ['symbol', 'market', 'tradeVolume', 'type', 'supply', 'activity', 'purchasePrice', 'sellPrice'])
    }
}
