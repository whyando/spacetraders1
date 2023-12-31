import assert from 'assert'
import Pathfinding from './pathfinding.js'
import { sys } from './util.js'
import Analytics from './analytics.js'
import { v4 as uuidv4 } from 'uuid'

function validate_response(resp) {
    if (resp.status >= 200 && resp.status < 300) return
    if (resp.data.data) {
        throw new Error(`request failed: ${resp.status} ${JSON.stringify(resp.data.data)}`)
    }
    else {
        throw new Error(`request failed: ${resp.status} ${JSON.stringify(resp.data)}`)
    }
}

class Ship {
    _ship = null
    _client = null

    constructor(client, universe, ship) {
        this._client = client
        this._universe = universe
        this._ship = ship
    }

    // static async new_fetch(ship_symbol) {
    //     const ship = new Ship()
    //     const uri = `https://api.spacetraders.io/v2/my/ships/${ship_symbol}`
    //     const resp = await this._client.get(uri)
    //     validate_response(resp)
    //     ship._ship = resp.data.data
    //     return ship
    // }

    get ship() { return this._ship }
    get cargo() { return this._ship.cargo }
    get nav() { return this._ship.nav }
    get symbol() { return this._ship.symbol }
    get fuel() { return this._ship.fuel }
    get engine() { return this._ship.engine }

    async extract() {
        await this.orbit()
        const cd = this._ship.cooldown.remainingSeconds
        if (cd > 0) {
            console.log(`waiting ${cd} seconds`)
            await new Promise(r => setTimeout(r, cd * 1000))
        }
        console.log(`Extracting ${this._ship.symbol}`)
        const uri = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/extract`
        const resp = await this._client.post(uri, {})
        validate_response(resp)
    
        const { extraction, cooldown, cargo } = resp.data.data
        this._ship.cargo = cargo
        this._ship.cooldown = cooldown
        console.log(JSON.stringify(extraction))
        return resp.data.data
    }

    async extract_survey(survey) {
        const cd = this._ship.cooldown.remainingSeconds
        if (cd > 0) {
            console.log(`waiting ${cd} seconds`)
            await new Promise(r => setTimeout(r, cd * 1000))
        }
        // recheck survey for expiration
        const ms_till_expire = (new Date(survey.expiresAt)).getTime() - (new Date()).getTime()
        if (ms_till_expire <= 1000) {
            console.log(`Preempted survey expiring`)
            return {
                error: {
                    message: '[preempted] Ship survey failed. Target signature is no longer in range or valid.',
                    code: 4221,
                }
            }
        }

        console.log(`Extracting ${this._ship.symbol} with survey`)
        const uri = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/extract/survey`
        const resp = await this._client.post(uri, survey, { validateStatus: false })
        if ((resp.status >= 400 && resp.status < 500) && resp.data.error) {
            return resp.data
        }
        // handle exhaust response,
        // handle overmined response
        validate_response(resp)

        const { extraction, cooldown, cargo } = resp.data.data
        this._ship.cargo = cargo
        this._ship.cooldown = cooldown
        console.log(JSON.stringify(extraction))
        return resp.data
    }

    async siphon() {
        await this.orbit()
        const cd = this._ship.cooldown.remainingSeconds
        if (cd > 0) {
            console.log(`waiting ${cd} seconds`)
            await new Promise(r => setTimeout(r, cd * 1000))
        }
        console.log(`Siphoning ${this._ship.symbol}`)
        const uri = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/siphon`
        const resp = await this._client.post(uri, {})
        validate_response(resp)
    
        const { siphon, cooldown, cargo } = resp.data.data
        this._ship.cargo = cargo
        this._ship.cooldown = cooldown
        console.log(JSON.stringify(siphon))
        return resp.data.data
    }

    async survey() {
        const cd = this._ship.cooldown.remainingSeconds
        if (cd > 0) {
            console.log(`waiting ${cd} seconds`)
            await new Promise(r => setTimeout(r, cd * 1000))
        }
        console.log(`Surveying ${this._ship.symbol}`)
        const uri = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/survey`
        const resp = await this._client.post(uri, {})
        validate_response(resp)

        const { surveys, cooldown } = resp.data.data
        this._ship.cooldown = cooldown
        return surveys.map(s => ({ ...s, uuid: uuidv4() }))
    }

    async dock() {
        if (this._ship.nav.status == 'DOCKED')
            return
        console.log(`Docking ${this._ship.symbol}`)
        const uri = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/dock`
        const resp = await this._client.post(uri, {})
        validate_response(resp)
        const { nav } = resp.data.data
        this._ship.nav = nav
        assert(this._ship.nav.status == 'DOCKED')
    }

    async orbit() {
        if (this._ship.nav.status == 'IN_ORBIT')
            return
        console.log(`Orbiting ${this._ship.symbol}`)
        const uri = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/orbit`
        const resp = await this._client.post(uri, {})
        validate_response(resp)
        const { nav } = resp.data.data
        this._ship.nav = nav
        assert(this._ship.nav.status == 'IN_ORBIT')
    }

    async flight_mode(target) {
        if (this._ship.nav.flightMode == target)
            return
        console.log(`Setting flight mode for ${this._ship.symbol} to ${target}`)
        const uri = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/nav`
        const resp = await this._client.patch(uri, { flightMode: target })
        validate_response(resp)
        const nav = resp.data.data
        this._ship.nav = nav
        assert(this._ship.nav.flightMode == target)
    }

    async navigate(waypoint_symbol, { wait = true } = {}) {
        assert.equal(this.is_in_transit(), false)
        if (this._ship.nav.waypointSymbol == waypoint_symbol)
            return
        await this.orbit()
        console.log(`Navigating ${this._ship.symbol} to ${waypoint_symbol}`)
        const uri = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/navigate`
        const resp = await this._client.post(uri, { waypointSymbol: waypoint_symbol })
        validate_response(resp)
        const { fuel, nav } = resp.data.data
        this._ship.fuel = fuel
        this._ship.nav = nav
    
        if (wait) {
            await this.wait_for_transit()
            // mutate this._ship to change nav.status from IN_TRANSIT to IN_ORBIT ?
        }
        return resp.data.data
    }

    async warp(waypoint_symbol, { wait = true } = {}) {
        assert.equal(this.is_in_transit(), false)
        if (this._ship.nav.waypointSymbol == waypoint_symbol)
            return
        await this.orbit()
        console.log(`Warping ${this._ship.symbol} to ${waypoint_symbol}`)
        const uri = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/warp`
        const resp = await this._client.post(uri, { waypointSymbol: waypoint_symbol })
        validate_response(resp)
        const { fuel, nav } = resp.data.data
        this._ship.fuel = fuel
        this._ship.nav = nav
    
        if (wait) {
            await this.wait_for_transit()
            // mutate this._ship to change nav.status from IN_TRANSIT to IN_ORBIT ?
        }
        return resp.data.data
    }

    async jump(waypoint_symbol) {
        assert.equal(this.is_in_transit(), false)
        if (this._ship.nav.waypointSymbol == waypoint_symbol)
            return
        const cd = this._ship.cooldown.remainingSeconds
        if (cd > 0) {
            console.log(`waiting ${cd} seconds`)
            await new Promise(r => setTimeout(r, cd * 1000))
        }
        await this.orbit()
        console.log(`Jumping ${this._ship.symbol} to ${waypoint_symbol}`)
        const uri = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/jump`
        const resp = await this._client.post(uri, { waypointSymbol: waypoint_symbol })
        validate_response(resp)

        console.log(JSON.stringify(resp.data.data))
        const { cooldown, nav, transaction } = resp.data.data
        this._ship.cooldown = cooldown
        this._ship.nav = nav

        await this.wait_for_transit()
        // mutate this._ship ?
        return resp.data.data
    }

    is_in_transit() {
        const arrivalTime = new Date(this._ship.nav.route.arrival)
        // console.log(`arrivalTime: ${arrivalTime}`)
        const now = new Date()
        return arrivalTime.valueOf() >= now.valueOf()
    }

    async wait_for_transit() {
        const arrivalTime = new Date(this._ship.nav.route.arrival)
        const now = new Date()
        const ms = arrivalTime - now + 1000
        if (ms < 0) return
        console.log(`waiting ${ms/1000}s for navigation`)
        await new Promise(r => setTimeout(r, ms))        
    }
    
    async refresh_market() {
        await this.wait_for_transit()
        const waypoint_symbol = this._ship.nav.waypointSymbol
        const system_symbol = sys(waypoint_symbol)
        console.log(`Refreshing market for ${waypoint_symbol}`)
        const url = `https://api.spacetraders.io/v2/systems/${system_symbol}/waypoints/${waypoint_symbol}/market`
        const response = await this._client.get(url)
        validate_response(response)
        const market = response.data.data
        if (!market.tradeGoods) {
            throw new Error(`no trade goods while fetching market on ${waypoint_symbol}`)
        }
        market.timestamp = new Date()
        await Analytics.record_market(market)
        return market
    }

    async refresh_shipyard() {
        await this.wait_for_transit()
        const waypoint_symbol = this._ship.nav.waypointSymbol
        const system_symbol = sys(waypoint_symbol)
        console.log(`Refreshing shipyard for ${waypoint_symbol}`)
        const url = `https://api.spacetraders.io/v2/systems/${system_symbol}/waypoints/${waypoint_symbol}/shipyard`
        const response = await this._client.get(url)
        validate_response(response)
        const shipyard = response.data.data
        if (!shipyard.ships) {
            throw new Error(`no ships while fetching shipyard on ${waypoint_symbol}`)
        }
        shipyard.timestamp = new Date()
        return shipyard
    }

    async buy_good(goodSymbol, quantity) {
        await this.wait_for_transit()
        await this.dock()
        console.log(`Buying ${quantity} ${goodSymbol} for ${this._ship.symbol}`)
        const url = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/purchase`
        const resp = await this._client.post(url, { symbol: goodSymbol, units: quantity })
        validate_response(resp)
        // console.log(resp.data)
        const { agent, cargo, transaction } = resp.data.data
        this._ship.cargo = cargo
        console.log(`Bought ${transaction.units} ${transaction.tradeSymbol} for ${transaction.totalPrice}`)
        return resp.data.data
    }

    async sell_good(goodSymbol, quantity) {
        await this.wait_for_transit()
        await this.dock()
        console.log(`Selling ${quantity} ${goodSymbol} for ${this._ship.symbol}`)
        const url = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/sell`
        const resp = await this._client.post(url, { symbol: goodSymbol, units: quantity })
        validate_response(resp)
        // console.log(resp.data)
        const { agent, cargo, transaction } = resp.data.data
        this._ship.cargo = cargo
        console.log(`Sold ${transaction.units} ${transaction.tradeSymbol} for ${transaction.totalPrice}`)
        return resp.data.data
    }

    async jettison_all_cargo() {
        for (const good of this._ship.cargo.inventory) {
            await this.jettison(good.symbol, good.units)
        }
    }

    async jettison_all(goodSymbol) {
        const units = this._ship.cargo.inventory.find(g => g.symbol == goodSymbol)?.units ?? 0
        if (units == 0) return
        await this.jettison(goodSymbol, units)
    }

    async jettison(goodSymbol, quantity) {
        console.log(`Jettisoning ${quantity} ${goodSymbol} for ${this._ship.symbol}`)
        const url = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/jettison`
        const resp = await this._client.post(url, { symbol: goodSymbol, units: quantity })
        validate_response(resp)

        const { cargo } = resp.data.data
        this._ship.cargo = cargo
    }

    // minimum_fuel_level: 'refuel to at least this level'
    // maxFuelMissing: 'this is the maximum that can be missing after refueling'
    async refuel({ maxFuelMissing = 100, minimum_fuel_level = 0, fromCargo = false } = {}) {
        await this.wait_for_transit()
        console.log(JSON.stringify(this._ship.fuel))

        if (minimum_fuel_level) {
            maxFuelMissing = Math.min(maxFuelMissing, this._ship.fuel.capacity - minimum_fuel_level)
        }
        let missing_fuel = 100 * Math.ceil(((this._ship.fuel.capacity - maxFuelMissing) - this._ship.fuel.current)/100)
        if (missing_fuel <= 0)
            return


        await this.dock()
        console.log(`Refueling ${this._ship.symbol}`)
        const url = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/refuel`
        const resp = await this._client.post(url, { units: missing_fuel, fromCargo: fromCargo })
        validate_response(resp)
        const { agent, fuel, transaction } = resp.data.data
        this._ship.fuel = fuel
        console.log(JSON.stringify(this._ship.fuel))
        console.log(`Bought ${transaction.units} ${transaction.tradeSymbol} for ${transaction.totalPrice}`)
        return resp.data.data
    }

    async deliver_contract(contract_id, tradeSymbol, units) {
        await this.wait_for_transit()
        await this.dock()
        console.log(`Delivering contract for ${this._ship.symbol}`)
        const url = `https://api.spacetraders.io/v2/my/contracts/${contract_id}/deliver`
        const resp = await this._client.post(url, {
            shipSymbol: this._ship.symbol,
            tradeSymbol: tradeSymbol,
            units: units
        })
        validate_response(resp)
        const { contract, cargo } = resp.data.data
        this._ship.cargo = cargo
        return contract
    }

    async negotiate_contract() {
        await this.wait_for_transit()
        await this.dock()
        console.log(`Negotiating contract for ${this._ship.symbol}`)
        const uri = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/negotiate/contract`
        const resp = await this._client.post(uri, {})
        validate_response(resp)
        const { contract } = resp.data.data
        return contract
    }

    async supply_construction(waypoint, symbol, units) {
        await this.wait_for_transit()
        await this.dock()
        const waypoint_symbol = waypoint // this._ship.nav.waypointSymbol
        const system_symbol = sys(waypoint_symbol)
        console.log(`Supplying construction for ${this._ship.symbol}`)
        const uri = `https://api.spacetraders.io/v2/systems/${system_symbol}/waypoints/${waypoint_symbol}/construction/supply`
        const resp = await this._client.post(uri, {
            shipSymbol: this._ship.symbol,
            tradeSymbol: symbol,
            units: units
        })
        validate_response(resp)
        const { construction, cargo } = resp.data.data
        this._ship.cargo = cargo
        console.log(JSON.stringify(construction))
        return construction        
    }

    // if the start point is not a market, this is pretty good
    // if the end point is not market, then we make sure the tank is half full at arrival,
    // so we can escape (may waste fuel since that constraint may be stronger than needed to esnure escape)

    // except when if it's direct between two non-markets, we might end up in a situation where we can't escape, or no route is found
    async goto(target_waypoint_symbol, { minimum_fuel_after_transit = null } = {}) {
        assert(this.is_in_transit() == false)
        if (this._ship.nav.waypointSymbol == target_waypoint_symbol)
            return
        // probe
        if (this.ship.fuel.capacity == 0) {
            await this.navigate(target_waypoint_symbol)
            await this.wait_for_transit()
            return
        }
        const route = await Pathfinding.generate_route(this._universe,
            this._ship.nav.waypointSymbol,
            target_waypoint_symbol,
            {
                max_fuel: this.ship.fuel.capacity,
                engine_speed: this.ship.engine.speed,
                initial_leg_max_fuel: this.ship.fuel.current,
                final_leg_max_fuel: Math.round(this.ship.fuel.current * 0.5),
            }
        )
        console.log('route:', route.map(x => x.dest))
        for (const leg of route) {
            // !! bug: assumes we are leaving from a market
            await this.refuel({minimum_fuel_level: leg.fuel_cost})
            await this.flight_mode(leg.flight_mode)
            await this.navigate(leg.dest)
            await this.wait_for_transit()
        }
    }

    async scan_waypoints() {
        assert(this.is_in_transit() == false)
        const cd = this._ship.cooldown.remainingSeconds
        if (cd > 0) {
            console.log(`waiting ${cd} seconds`)
            await new Promise(r => setTimeout(r, cd * 1000))
        }
        await this.orbit()
        console.log(`Scanning waypoints ${this._ship.symbol}`)
        const uri = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/scan/waypoints`
        const resp = await this._client.post(uri, {})
        validate_response(resp)
        const { cooldown, waypoints } = resp.data.data
        this._ship.cooldown = cooldown
        return waypoints
    }

    async chart() {
        assert(this.is_in_transit() == false)
        console.log(`Charting ${this._ship.symbol}`)
        const uri = `https://api.spacetraders.io/v2/my/ships/${this._ship.symbol}/chart`
        const resp = await this._client.post(uri, {})
        validate_response(resp)
        const { chart, waypoint } = resp.data.data
        return { chart, waypoint }
    }
}

export default Ship
