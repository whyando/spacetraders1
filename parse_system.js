
import Universe from './src/universe.js'

const system_symbol = 'X1-ZA74'

const universe = await Universe.load()

const sys = await universe.get_system(system_symbol)

for (const w of sys.waypoints) {
    const is_market = w.traits.some(t => t.symbol === 'MARKETPLACE')
    const is_shipyard = w.traits.some(t => t.symbol === 'SHIPYARD')
    if (!is_market) continue
    const market = await universe.get_remote_market(w.symbol)
    const i = market.imports.map(i => i.symbol).join(', ')
    const e = market.exports.map(i => i.symbol).join(', ')
    const exchange = market.exchange.map(i => i.symbol).join(', ')
    if (i.length == 0 && e.length == 0) continue
    console.log(`${w.symbol}\t${w.x}\t${w.y}`)

    if (is_shipyard) {
        const shipyard = await universe.get_remote_shipyard(w.symbol)
        const ships = shipyard.shipTypes.map(s => s.type).join(', ')
        console.log(`\tSHIPYARD: ${ships}`)
    }
    // console.log(`\tIMPORT: ${i}`)
    // console.log(`\tEXPORT: ${e}`)
    // console.log(`\tEXCHANGE: ${exchange}`)
}
