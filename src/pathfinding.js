/*
    Intra-system pathfinding
    - edges set by max fuel constraint
    - minimise total time
    - CRUISE edges only
    - fuel cost is not considered
*/

import { sys } from './util.js'
import assert from 'assert'
import dijkstra from 'dijkstrajs'

class Pathinding {
    static async generate_route(universe, src_waypoint, dest_waypoint, {
        max_fuel = 99,
        // Only applied if SRC or DEST are not MARKETPLACE waypoints
        initial_leg_max_fuel_ratio = 0.5,
        final_leg_max_fuel_ratio = 0.5,
    } = {}) {
        const system_waypoint = sys(src_waypoint)
        assert.equal(system_waypoint, sys(dest_waypoint), 'cannot generate inter-system routes')
        assert.notEqual(src_waypoint, dest_waypoint, 'cannot generate zero-length routes')

        console.log('generating route', src_waypoint, dest_waypoint)

        const system = await universe.get_system(sys(src_waypoint))
        const market_waypoints = system.waypoints.filter(w => w.traits.some(t => t.symbol == 'MARKETPLACE'))
        const graph = {}

        for (const x of market_waypoints) {
            if (!graph[x.symbol]) graph[x.symbol] = {}
            for (const y of market_waypoints) {
                if (x == y) continue
                const distance = Math.max(Math.round(Math.sqrt((x.x - y.x)**2 + (x.y - y.y)**2)), 1)
                const fuel_cost = distance
                const duration = Math.max(Math.round(distance / 10), 1)
                if (fuel_cost > max_fuel) continue
                graph[x.symbol][y.symbol] = duration
            }
        }

        // add extra directed edges at start and end
        const src = system.waypoints.find(w => w.symbol == src_waypoint)
        const dest = system.waypoints.find(w => w.symbol == dest_waypoint)
        const src_is_market = src.traits.some(t => t.symbol == 'MARKETPLACE')
        const dest_is_market = dest.traits.some(t => t.symbol == 'MARKETPLACE')
        if (!src_is_market) {
            graph[src.symbol] = {}
            for (const x of market_waypoints) {
                const distance = Math.max(Math.round(Math.sqrt((src.x - x.x)**2 + (src.y - x.y)**2)), 1)
                const fuel_cost = distance
                const duration = Math.max(Math.round(distance / 10), 1)
                if (fuel_cost > max_fuel * initial_leg_max_fuel_ratio) continue
                graph[src.symbol][x.symbol] = duration
            }
        }
        if (!dest_is_market) {
            for (const x of market_waypoints) {
                const distance = Math.max(Math.round(Math.sqrt((dest.x - x.x)**2 + (dest.y - x.y)**2)), 1)
                const fuel_cost = distance
                const duration = Math.max(Math.round(distance / 10), 1)
                if (fuel_cost > max_fuel * final_leg_max_fuel_ratio) continue
                graph[x.symbol][dest.symbol] = duration
            }
        }
        if (!src_is_market && !dest_is_market) {
            const distance = Math.max(Math.round(Math.sqrt((src.x - dest.x)**2 + (src.y - dest.y)**2)), 1)
            const fuel_cost = distance
            const duration = Math.max(Math.round(distance / 10), 1)
            const fuel_bound = Math.min(max_fuel * final_leg_max_fuel_ratio, max_fuel * initial_leg_max_fuel_ratio)
            if (fuel_cost <= fuel_bound) {
                graph[src.symbol][dest.symbol] = duration
            }
        }

        const path = dijkstra.find_path(graph, src_waypoint, dest_waypoint)
        const steps = []
        for (let i = 1; i < path.length; i++) {
            const src = path[i-1]
            const dest = path[i]
            const duration = graph[src][dest]
            steps.push({ src, dest, duration })
        }
        return steps
    }
}

export default Pathinding


