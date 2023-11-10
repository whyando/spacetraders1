import Universe from './universe.js'

const universe = await Universe.load()

const system = await universe.get_system('X1-YH15')

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
        console.log(`${w.symbol}\t${good.symbol}\t$${good.purchasePrice}\t$${good.sellPrice}\t${good.tradeVolume}`)
        const trade = {
            market: w.symbol,
            ...good
        }
        // delete trade['type']
        if (good.type == 'IMPORT')
            imports.push(trade)
        else if (good.type == 'EXPORT')
            exports.push(trade)
        else if (good.type == 'EXCHANGE')
            exchanges.push(trade)
        else
            throw new Error(`unknown trade type ${good.type}`)

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

console.log('exports')
console.table(exports)

console.log('imports')
console.table(imports)

console.log('exchanges')
console.table(exchanges)

