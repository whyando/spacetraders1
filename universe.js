
import Client from './client.js'
import assert from 'assert'
import { sys } from './util.js'
import fs from 'fs/promises'

export default class Universe {
    markets = {}
    markets_local = {}
    systems = null
    factions = null
    client = null

    constructor() {
        this.client = new Client()
    }

    async get_market(waypoint) {
        const system_symbol = sys(waypoint)
        const market = await this.client.load_resource(
            `data/markets/${waypoint}.json`,
            `/v2/systems/${system_symbol}/waypoints/${waypoint}/market`,
            { map_fn: x => x.data })
        this.markets[waypoint] = market
        return market
    }

    async get_local_market(waypoint) {
        if (this.markets_local[waypoint]) {
            return this.markets_local[waypoint]
        }
        try {
            await fs.access(`data/markets_local/${waypoint}.json`)
        } catch (error) {
            return null
        }
        const market = JSON.parse(await fs.readFile(`data/markets_local/${waypoint}.json`, 'utf-8'))
        this.markets_local[waypoint] = market        
        return market
    }

    async save_local_market(market) {
        const waypoint = market.symbol
        this.markets_local[waypoint] = market
        await fs.mkdir(`data/markets_local`, { recursive: true })
        await fs.writeFile(`data/markets_local/${waypoint}.json`, JSON.stringify(market, null, 2))
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
