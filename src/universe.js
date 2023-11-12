
import Client from './client.js'
import assert from 'assert'
import { sys } from './util.js'
import fs from 'fs/promises'

export default class Universe {
    local_markets = {}
    local_shipyards = {}
    systems = null
    factions = null
    client = null

    constructor() {
        this.client = new Client()
    }

    async get_remote_market(waypoint) {
        const system_symbol = sys(waypoint)
        const market = await this.client.load_resource(
            `data/remote_market/${waypoint}.json`,
            `/v2/systems/${system_symbol}/waypoints/${waypoint}/market`,
            { map_fn: x => x.data })
        return market
    }

    async get_remote_shipyard(waypoint) {
        const system_symbol = sys(waypoint)
        const shipyard = await this.client.load_resource(
            `data/remote_shipyard/${waypoint}.json`,
            `/v2/systems/${system_symbol}/waypoints/${waypoint}/shipyard`,
            { map_fn: x => x.data })
        return shipyard
    }

    async get_remote_construction(waypoint) {
        const system_symbol = sys(waypoint)
        const construction = await this.client.load_resource(
            `data/remote_construction/${waypoint}.json`,
            `/v2/systems/${system_symbol}/waypoints/${waypoint}/construction`,
            { map_fn: x => x.data })
        return construction
    }

    async save_remote_construction(construction) {
        // this should probably be a method on the client
        const waypoint = construction.symbol
        await fs.mkdir(`data/remote_construction`, { recursive: true })
        await fs.writeFile(`data/remote_construction/${waypoint}.json`, JSON.stringify(construction, null, 2) + '\n')
    }

    async get_local_market(waypoint) {
        if (this.local_markets[waypoint]) {
            return this.local_markets[waypoint]
        }
        try {
            await fs.access(`data/local_market/${waypoint}.json`)
        } catch (error) {
            return null
        }
        const market = JSON.parse(await fs.readFile(`data/local_market/${waypoint}.json`, 'utf-8'))
        this.local_markets[waypoint] = market        
        return market
    }

    async save_local_market(market) {
        const waypoint = market.symbol
        this.local_markets[waypoint] = market
        await fs.mkdir(`data/local_market`, { recursive: true })
        await fs.writeFile(`data/local_market/${waypoint}.json`, JSON.stringify(market, null, 2))
    }

    async get_local_shipyard(waypoint) {
        if (this.local_shipyards[waypoint]) {
            return this.local_shipyards[waypoint]
        }
        try {
            await fs.access(`data/local_shipyard/${waypoint}.json`)
        } catch (error) {
            return null
        }
        const shipyard = JSON.parse(await fs.readFile(`data/local_shipyard/${waypoint}.json`, 'utf-8'))
        this.local_shipyards[waypoint] = shipyard        
        return shipyard
    }
    
    async save_local_shipyard(shipyard) {
        const waypoint = shipyard.symbol
        this.local_shipyards[waypoint] = shipyard
        await fs.mkdir(`data/local_shipyard`, { recursive: true })
        await fs.writeFile(`data/local_shipyard/${waypoint}.json`, JSON.stringify(shipyard, null, 2))
    }

    async get_system(system_symbol) {
        const system_waypoints = await this.client.load_resource(
            `data/system_waypoints/${system_symbol}.json`,
            `/v2/systems/${system_symbol}/waypoints`,
            { paginated: true })
        assert(this.systems[system_symbol].waypoints.length == system_waypoints.length)
        this.systems[system_symbol].waypoints = system_waypoints
        return this.systems[system_symbol]
    }

    async load_init() {
        const systems = await this.client.load_resource('data/systems.json', '/v2/systems.json')
        this.systems = {}
        for (const system of systems) {
            this.systems[system.symbol] = system
        }
    }

    static async load() {
        const u = new Universe()
        await u.load_init()
        return u
    }
}
