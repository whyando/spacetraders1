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

    async buy_ship(shipyard, ship_type) {
        const uri = `/v2/my/ships`
        console.log(`buying ship ${ship_type} at ${shipyard}`)
        const response = await this.client.post(uri, {
            shipType: ship_type,
            waypointSymbol: shipyard,
        }, { validateStatus: false })
        if (response.status != 201) {
            throw new Error(`buy_ship failed: ${response.status} ${response.data.error.message}`)
        }
        const { agent, ship, transaction: t } = response.data.data
        console.log(`bought ${ship_type} ${t.shipSymbol} for $${t.price} at ${t.waypointSymbol}`)
        Object.assign(this.agent, agent)
        this.ships[ship.symbol] = ship
        return ship
    }

    async get_active_contract() {
        const contract = this.contracts.find(c => c.fulfilled == false)
        return contract
    }

    async accept_contract(contract_id) {
        console.log('accepting contract')
        const contract = this.contracts.find(c => c.id == contract_id)
    
        const uri = `https://api.spacetraders.io/v2/my/contracts/${contract.id}/accept`
        const resp = await this.client.post(uri, {})        
        const { contract: contract_upd, agent } = resp.data.data
        Object.assign(this.agent, agent)
        Object.assign(contract, contract_upd)
    }

    async fulfill_contract(contract_id) {
        console.log('fulfilling contract')
        const contract = this.contracts.find(c => c.id == contract_id)
    
        const uri = `https://api.spacetraders.io/v2/my/contracts/${contract.id}/fulfill`
        const resp = await this.client.post(uri, {})
        const { contract: contract_upd, agent } = resp.data.data
        Object.assign(this.agent, agent)
        Object.assign(contract, contract_upd)
    }

    async update_contract(contract_upd) {
        console.log('updating contract')
        const contract = this.contracts.find(c => c.id == contract_upd.id)
        Object.assign(contract, contract_upd)
    }

    async append_contract(contract) {
        this.contracts.push(contract)
    }

    async load_contracts() {
        // kinda want these in separate files
        this.contracts = await this.client.load_resource(
            `data/contracts/${this.callsign}.json`, 
            '/v2/my/contracts', 
            {
                paginated: true,
                always_fetch: true,
            })
    }

    async load_all() {
        const { token } = await load_or_register(this.faction, this.callsign)
        this.client = new Client(token)
        await this.load_agent()
        await this.load_ships()
        await this.load_contracts()
    }

    ship_controller(ship_symbol) {
        return new Ship(this.client, this.universe, this.ships[ship_symbol])
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
