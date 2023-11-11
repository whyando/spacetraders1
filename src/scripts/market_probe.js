
export default async function market_probe_script(universe, probe, { system_symbol }) {
    const system = await universe.get_system(system_symbol)
    
    while (true) {
        await probe.wait_for_transit()
        const ship_location = probe.nav.waypointSymbol
        const current_waypoint = system.waypoints.find(w => w.symbol == ship_location)

        const options = []
        for (const w of system.waypoints) {
            const is_market = w.traits.some(t => t.symbol == 'MARKETPLACE')
            if (!is_market) continue

            // load local market
            const distance = Math.round(Math.sqrt((w.x - current_waypoint.x)**2 + (w.y - current_waypoint.y)**2))
            const market = await universe.get_local_market(w.symbol)
            options.push({ waypoint: w.symbol, distance, market })
        }
        const now = (new Date()).valueOf()
        const weight = (t, d) => {
            // more than 3 hours: distance only
            // less than 3 hours: recently updated markets are less important
            const age = (now - new Date(t).valueOf()) / 1000 / 60 / 60
            if (age > 3) {
                return d
            } else {
                return d + (3 - age) * 250
            }
        }
        options.sort((a, b) => weight(a.market?.timestamp ?? 0, a.distance) - weight(b.market?.timestamp ?? 0, b.distance))
        // options.map(o => {
        //     console.log(`${o.distance}\t${o.waypoint}\t${o.market?.timestamp}\t${weight(o.market?.timestamp ?? 0, o.distance)}`)
        // })
        const target = options[0].waypoint
        console.log(`target: ${target}`)
        await probe.flight_mode('BURN')
        await probe.navigate(target)
        await probe.wait_for_transit()
        await universe.save_local_market(await probe.refresh_market())
    }
}
