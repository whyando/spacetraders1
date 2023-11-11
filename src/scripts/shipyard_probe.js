
export default async function shipyard_probe_script(universe, probe, { system_symbol }) {    
    while (true) {
        await probe.wait_for_transit()

        const ship_waypoint = probe.nav.waypointSymbol
        const options = await get_options(universe, system_symbol, ship_waypoint)

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
        options.sort((a, b) => weight(a.shipyard?.timestamp ?? 0, a.distance) - weight(b.shipyard?.timestamp ?? 0, b.distance))
        // options.map(o => {
        //     console.log(`${o.distance}\t${o.waypoint}\t${o.market?.timestamp}\t${weight(o.shipyard?.timestamp ?? 0, o.distance)}`)
        // })
        const target = options[0].waypoint
        console.log(`target: ${target}`)
        await probe.flight_mode('BURN')
        await probe.navigate(target)
        await probe.wait_for_transit()
        await universe.save_local_shipyard(await probe.refresh_shipyard())
    }
}

const get_options = async (universe, system_symbol, current_waypoint_symbol) => {
    const system = await universe.get_system(system_symbol)
    const waypoint = system.waypoints.find(w => w.symbol == current_waypoint_symbol)

    const options = []
    for (const w of system.waypoints) {
        const is_shipyard = w.traits.some(t => t.symbol == 'SHIPYARD')
        if (!is_shipyard) continue

        // load local market
        const distance = Math.round(Math.sqrt((w.x - waypoint.x)**2 + (w.y - waypoint.y)**2))
        const shipyard = await universe.get_local_shipyard(w.symbol)
        options.push({ waypoint: w.symbol, distance, shipyard })
    }
    return options
}
