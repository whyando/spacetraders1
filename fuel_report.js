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
            // delete trade['sellPrice']
        }
        else if (good.type == 'EXCHANGE')
            exchanges.push(trade)
        else
            throw new Error(`unknown trade type ${good.type}`)

        if (!goods[good.symbol]) {
            goods[good.symbol] = []
        }
        goods[good.symbol].push(trade)
    }
}

const type_map = {
    EXPORT: 1,
    IMPORT: 2,
    EXCHANGE: 3,
}

for (const [symbol, trades] of Object.entries(goods)) {
    if (symbol != 'FUEL') continue
    trades.sort((a, b) => type_map[a.type] - type_map[b.type])
    console.log(`${symbol}:`)
    console.table(trades, ['market', 'tradeVolume', 'type', 'supply', 'activity', 'purchasePrice', 'sellPrice'])
}

