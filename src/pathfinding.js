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


