import Universe from './src/universe.js'
import dijkstra from 'dijkstrajs'
import { sys } from './src/util.js'
import fs from 'fs/promises'

const FUEL_MAX = 800

const universe = await Universe.load()
const systems = Object.values(universe.systems).filter(s => s.waypoints.length > 0)

const num_jumpgates = systems.reduce((acc, s) => acc + s.waypoints.filter(w => w.type === 'JUMP_GATE').length, 0)
console.log(`systems: ${systems.length}`)
console.log(`jumpgates: ${num_jumpgates}`)

const gate_count = {
    constructing_gates: 0, // gate is under construction
    arrive_only: 0, // no market
    uncharted: 0, // traits unknown
    usuable: 0, // market and traits known
    total: 0,
}

const type = {}
const weight = {}

for (const x of systems) {
    weight[x.symbol] = {}
    type[x.symbol] = {}
}

for (const x of systems) {
    // warp
    for (const y of systems) {
        if (x.symbol === y.symbol) continue
        const dist = Math.round(Math.sqrt(Math.pow(x.x - y.x, 2) + Math.pow(x.y - y.y, 2)))
        if (dist <= FUEL_MAX) {
            weight[x.symbol][y.symbol] = dist
            type[x.symbol][y.symbol] = 'warp'
        }
    }

    // jumpgate
    // requirements:
    // 1. both gates are constructed
    // 2. source gate is a market
    // 3. (we know a jump connection exists, because one of the gates is charted, or we went there)
    const jumpgate = x.waypoints.find(w => w.type === 'JUMP_GATE')
    if (jumpgate === undefined) 
        continue
    gate_count.total++
    // console.log(`jumpgate at ${jumpgate.symbol}`)
    const system = await universe.get_system(x.symbol)
    const waypoint = system.waypoints.find(w => w.type === 'JUMP_GATE')
    if (!waypoint.traits.some(t => t.symbol == 'UNCHARTED')) {
        const conn = await universe.get_remote_jumpgate_connections(jumpgate.symbol)
        const x_market = waypoint.traits.some(t => t.symbol == 'MARKETPLACE')
        const x_constructed = waypoint.isUnderConstruction === false
        if (!x_market) {
            gate_count.arrive_only++
        } else if (!x_constructed) {
            gate_count.constructing_gates++
        } else {
            gate_count.usuable++
        }

        if (!x_constructed) continue
        for (const conn_y of conn) {
            const y = await universe.get_system(sys(conn_y))
            const y_waypoint = y.waypoints.find(w => w.type === 'JUMP_GATE') 
            const y_market = y_waypoint.traits.some(t => t.symbol == 'MARKETPLACE')
            const y_constructed = y_waypoint.isUnderConstruction === false
            if (!y_constructed) continue
            const dist = Math.round(Math.sqrt(Math.pow(x.x - y.x, 2) + Math.pow(x.y - y.y, 2)))
            if (x_market) {
                weight[x.symbol][y.symbol] = Math.round(dist/10)
                type[x.symbol][y.symbol] = 'jumpgate'
            }
            if (y_market) {
                weight[y.symbol][x.symbol] = Math.round(dist/10)
                type[y.symbol][x.symbol] = 'jumpgate'
            }
        }
    } else {
        gate_count.uncharted++
    }
}
console.log(`constructed graph`)
console.log(`gate count`, gate_count)

// transposition
const weight_rev = []
const type_rev = []
for (const x of systems) {
    weight_rev[x.symbol] = {}
    type_rev[x.symbol] = {}
}
for (const x in weight) {
    for (const y in weight[x]) {
        weight_rev[y][x] = weight[x][y]
        type_rev[y][x] = type[x][y]
    }
}
console.log(`constructed reverse graph`)

const SRC = 'X1-ZA74'

const starter_systems = (await fs.readFile('STARTER_SYSTEMS.log', 'utf-8')).split('\n').filter(s => s.length > 0).map(s => s.split('\t')[0])

for (const DEST of starter_systems.slice(0, 25)) {
    console.log(DEST)
    const precessor = dijkstra.single_source_shortest_paths(weight_rev, DEST)
    let path = null
    try {
        path = dijkstra.extract_shortest_path_from_predecessor_list(precessor, SRC) 
        path.reverse()
    } catch (e) { }
    const route = []
    if (path) {
        for (let i = 0; i < path.length - 1; i++) {
            route.push({ from: path[i], to: path[i+1], type: type[path[i]][path[i+1]], weight: weight[path[i]][path[i+1]] })
        }
    }
    console.log(route)
    // cache precessor
    const x = {
        system: DEST,
        generated: new Date().toISOString(),
        gate_count,
        precessor,
    }
    await fs.mkdir('data/nav-cache', { recursive: true })
    await fs.writeFile(`data/nav-cache/${DEST}.json`, JSON.stringify(x, null, 2))
}
