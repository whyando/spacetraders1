import axios from 'axios'
import fs from 'fs/promises'
import Client from './client.js'
import Ship from './ship.js'

async function load_or_register(faction, callsign) {
    const agent_path = `data/agents/${callsign}.json`
    let exists = false
    try {
        await fs.access(agent_path)
        exists = true
    } catch (e) {}
    if (!exists) {
        console.log(`registering agent ${callsign}`)
        const response = await axios.post('https://api.spacetraders.io/v2/register', {
            faction: faction,
            symbol: callsign,
        })
        console.log(response.status)
        const { agent, contract, faction: faction1, ship, token } = response.data.data
        await fs.mkdir('data/agents', { recursive: true })
        await fs.writeFile(agent_path, JSON.stringify({token}))
    }
    const agent = JSON.parse(await fs.readFile(agent_path, 'utf8'))
    // axios.defaults.headers.common['Authorization'] = `Bearer ${agent.token}`
    return agent
}

export default class Agent {
    callsign = null
    faction = null
    token = null
    client = null

    agent = null
    ships = null
    contracts = null

    async load_agent() {
        this.agent = await this.client.load_resource(
            `data/agent/${this.callsign}.json`,
            '/v2/my/agent',
            {
                map_fn: i => i.data,
                always_fetch: true,
            }
        )
    }

    async load_ships() {
        this.ships = {}
        const ships = await this.client.load_resource(
            `data/ship/${this.callsign}.json`,
            '/v2/my/ships',
            {
                paginated: true,
                file_path_fn: (ship) => `data/ship/${ship.symbol}.json`,
                always_fetch: true,
            })
        for (const ship of ships) {
            this.ships[ship.symbol] = ship
        }
    }

    async load_contracts() {
        // kinda want these in separate files
        this.contracts = await this.client.load_resource(`data/contracts/${this.callsign}.json`, '/v2/my/contracts', {paginated: true})
    }

    async load_all() {
        const { token } = await load_or_register(this.faction, this.callsign)
        this.client = new Client(token)
        await this.load_agent()
        await this.load_ships()
        await this.load_contracts()
    }

    async ship_controller(ship_symbol) {
        return new Ship(this.client, this.ships[ship_symbol])
    }

    constructor(universe, faction, callsign) {
        this.universe = universe
        this.faction = faction
        this.callsign = callsign
    }

    static async load(universe, faction, callsign) {
        const a = new Agent(universe, faction, callsign)
        await a.load_all()                        
        return a
    }
}
