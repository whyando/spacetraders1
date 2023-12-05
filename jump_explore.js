
import Universe from './src/universe.js'
import { sys } from './src/util.js'
import dijkstra from 'dijkstrajs'

const jump_target = 'X1-FJ85-BE7E'

const universe = await Universe.load()
const target_system = universe.systems[sys(jump_target)]

const root = 'X1-AM81-ZF6D' // 'X1-ZA74-I53'

const conn = {}

const reachable = []

async function f(symbol) {
    if (conn[symbol]) return
    const system = await universe.get_system(sys(symbol))
    const waypoint = system.waypoints.find(w => w.symbol === symbol)
    const is_constructing = waypoint.isUnderConstruction
    if (is_constructing) {
        // console.log(`${symbol} is constructing`)
        conn[symbol] = []
    }
    else if (waypoint.traits.some(t => t.symbol === 'UNCHARTED')) {
        console.log(`${symbol} is uncharted`)
        conn[symbol] = []
        reachable.push({ symbol, uncharted: true })
    }
    else {
        reachable.push({ symbol })
        console.log(symbol)
        const connections = await universe.get_remote_jumpgate_connections(symbol)
        conn[symbol] = connections
        for (const connection of connections) {
            await f(connection)
        }
    }
}
await f(root)

console.log('graph done\n')

for (const s of reachable) {
    const system = universe.systems[sys(s.symbol)]
    // count waypoint types
    const waypoint_types = {}
    for (const w of system.waypoints) {
        waypoint_types[w.type] = (waypoint_types[w.type] || 0) + 1
    }
    console.log(s.symbol, waypoint_types)
    s.dist = Math.sqrt(Math.pow(system.x - target_system.x, 2) + Math.pow(system.y - target_system.y, 2))
}
reachable.sort((a, b) => a.dist - b.dist)
console.log(reachable)

// check for connections to X1-QY89

const graph = {}

for (const symbol in conn) {
    if (!graph[symbol]) graph[symbol] = {}
    for (const connection of conn[symbol]) {
        graph[symbol][connection] = 1
    }
}

const path = dijkstra.find_path(graph, root, jump_target) // 'X1-QY89-XA4Z'
console.log(path)
