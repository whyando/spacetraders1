import Universe from './src/universe.js'

const universe = await Universe.load()

const system_symbol = 'X1-NT56'
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
    }
}

const recipes = {
    'IRON': ['IRON_ORE'],
    'FAB_MATS': ['IRON', 'QUARTZ_SAND'],
}

for (const [output_symbol, input_symbols] of Object.entries(recipes)) {
    for (const w of system.waypoints) {
        const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
        if (!is_market) continue    
        const market = await universe.get_local_market(w.symbol)
        if (!market) continue
        if (!market.tradeGoods)
            throw new Error(`no trade goods at ${w.symbol}`)
        
        const is_export = market.exports.some(x => x.symbol == output_symbol)
        if (!is_export) continue
        for (const input_symbol of input_symbols) {
            const is_import = market.imports.some(x => x.symbol == input_symbol)
            if (!is_import) continue
        }

        console.log(`${w.symbol} ${output_symbol} <- ${input_symbols.join(', ')}`)
        console.log(`(${(new Date(market.timestamp)).toISOString()})`)
        
        const goods = []
        for (const symbol of [...input_symbols, output_symbol]) {
            const good = {
                market: w.symbol,
                ...market.tradeGoods.find(x => x.symbol == symbol)
            }
            if (good.type == 'IMPORT')
                delete good['purchasePrice']
            if (good.type == 'EXPORT')
                delete good['sellPrice']
            goods.push(good)
        }
        console.table(goods, ['symbol', 'market', 'tradeVolume', 'type', 'supply', 'activity', 'purchasePrice', 'sellPrice'])
    }
}
