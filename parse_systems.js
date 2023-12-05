import fs from 'fs/promises'
import Universe from './src/universe.js'
import { sys } from './src/util.js'

const CURRENT = 'X1-ZA74'
const TARGET = sys('X1-TJ77-X11E')

const universe = await Universe.load()

const systems = Object.values(universe.systems)

const target = systems.find(s => s.symbol === TARGET)
const current = systems.find(s => s.symbol === CURRENT)

for (const s of systems) {
    const has_jumpgate = s.waypoints.some(w => w.type === 'JUMP_GATE')
    const num_orbitalstations = s.waypoints.filter(w => w.type === 'ORBITAL_STATION').length
    s.dist_target =  Math.sqrt(Math.pow(s.x - target.x, 2) + Math.pow(s.y - target.y, 2))
    s.dist_current =  Math.sqrt(Math.pow(s.x - current.x, 2) + Math.pow(s.y - current.y, 2))
    s.num_orbitalstations = num_orbitalstations
    s.has_jumpgate = has_jumpgate
    s.non_asteroid = s.waypoints.filter(w => w.type !== 'ASTEROID').length
}
systems.sort((a, b) => a.dist_current - b.dist_current)
// systems.slice(0, 10000).forEach(s => {
//     console.log(`${s.symbol}\t${s.type}\t${s.non_asteroid}`)
// })
// throw new Error('stop')

// systems.sort((a, b) => b.waypoints.length - a.waypoints.length)
// systems.filter(s => s.num_orbitalstations == 1).sort((a, b) => a.dist - b.dist).slice(0,5).forEach(s => console.log(s.symbol, s.dist))
// throw new Error('stop')

const jump_systems = systems.filter(s => s.waypoints.some(w => w.type === 'JUMP_GATE')).length
console.log(`jump systems: ${jump_systems}`)

let idx = 0
for (const s of systems) {
    const has_jumpgate = s.waypoints.some(w => w.type === 'JUMP_GATE')
    // if (!has_jumpgate) continue
    if (s.non_asteroid < 20) continue
    const sys = await universe.get_system(s.symbol)
    const faction = sys.waypoints[0]?.faction?.symbol
    // console.log(sys.waypoints)
    const num_uncharted = sys.waypoints.filter(w => w.traits.some(t => t.symbol == 'UNCHARTED')).length
    const num_constructions = sys.waypoints.filter(w => w.isUnderConstruction).length

    console.log(`${s.symbol}\t${s.type}\t${s.non_asteroid}\t${s.dist_current}\t${s.waypoints.length}\t${s.num_orbitalstations}\t${num_uncharted}\t${num_constructions}\t${faction}`)

    const market_a1 = await universe.get_remote_market(`${s.symbol}-A1`)
    const market_a4 = await universe.get_remote_market(`${s.symbol}-A4`)
    const i = market_a1.imports.map(i => i.symbol).join(', ')
    const e = market_a4.exports.map(i => i.symbol).join(', ')
    // console.log(`\tIMPORT: ${i}`)
    // console.log(`\tEXPORT: ${e}`)
}

