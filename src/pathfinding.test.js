import Pathfinding from './pathfinding.js'
import assert from 'assert'

const mockUniverse = {
  async get_system(system) {
    // Mock implementation for get_system
    if (system == 'X1-S1') {
        return {
            waypoints: [
                { symbol: 'X1-S1-A', x: 0, y: 0, traits: [] },
                { symbol: 'X1-S1-B', x: 100, y: 0, traits: [{ symbol: 'MARKETPLACE' }] },
                { symbol: 'X1-S1-D', x: 200, y: 0, traits: [{ symbol: 'MARKETPLACE' }] },
                { symbol: 'X1-S1-D', x: 300, y: 0, traits: [{ symbol: 'MARKETPLACE' }] },
                { symbol: 'X1-S1-E', x: 400, y: 0, traits: [] },
            ],
        };
    } else {
        throw new Error(`Unknown system ${system}`);
    }
  },
}

describe('Pathfinding', () => {
    it('generates a valid route between two market waypoints', async () => {
        const srcWaypoint = 'X1-S1-B';
        const destWaypoint = 'X1-S1-D';

        const route = await Pathfinding.generate_route(mockUniverse, srcWaypoint, destWaypoint, { max_fuel: 100 });

        assert(Array.isArray(route));
        assert(route.length > 0);
        assert(route[0].src === srcWaypoint);
        assert(route[route.length - 1].dest === destWaypoint);
    });

    it('generates a valid route between two non-market waypoints', async () => {
        const srcWaypoint = 'X1-S1-A';
        const destWaypoint = 'X1-S1-E';

        const route = await Pathfinding.generate_route(mockUniverse, srcWaypoint, destWaypoint, { max_fuel: 200 });

        assert(Array.isArray(route));
        assert(route.length > 0);
        assert(route[0].src === srcWaypoint);
        assert(route[route.length - 1].dest === destWaypoint);
    });

    it('generates a valid route between two non-market waypoints - direct', async () => {
        const srcWaypoint = 'X1-S1-A';
        const destWaypoint = 'X1-S1-E';

        const route = await Pathfinding.generate_route(mockUniverse, srcWaypoint, destWaypoint, { max_fuel: 1000 });

        assert(Array.isArray(route));
        assert(route.length > 0);
        assert(route[0].src === srcWaypoint);
        assert(route[route.length - 1].dest === destWaypoint);
    });
});

