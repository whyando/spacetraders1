import { sys } from '../util.js'

const MARKET_REFRESH_INTERVAL = 15 * 60 * 1000
const SHIPYARD_REFRESH_INTERVAL = 15 * 60 * 1000

export default async function probe_idle_script(universe, probe, { waypoint_symbol }) {
    const system = await universe.get_system(sys(waypoint_symbol))
    const waypoint = system.waypoints.find(w => w.symbol == waypoint_symbol)

    const refresh_market = waypoint.traits.some(t => t.symbol == 'MARKETPLACE')
    const refresh_shipyard = waypoint.traits.some(t => t.symbol == 'SHIPYARD')

    await probe.wait_for_transit()
    await probe.flight_mode('BURN')
    await probe.navigate(waypoint_symbol)
    await probe.wait_for_transit()

    if (!refresh_market && !refresh_shipyard) return

    // Refresh market and shipyard every 15 minutes
    while (true) {
        let sleep_duration = 60 * 60 * 1000
        if (refresh_market) {
            const market = await universe.get_local_market(waypoint_symbol)
            const ts = market?.timestamp ?? 0
            const delay = MARKET_REFRESH_INTERVAL - ((new Date()).valueOf() - new Date(ts).valueOf())
            if (delay <= 0) {
                // console.log(`Refreshing market ${waypoint_symbol}`)
                await universe.save_local_market(await probe.refresh_market())
                continue
            } else {
                // console.log(`Sleeping for ${delay}ms before refreshing market ${waypoint_symbol}`)
                sleep_duration = Math.min(sleep_duration, delay)
            }
        }

        if (refresh_shipyard) {
            const shipyard = await universe.get_local_shipyard(waypoint_symbol)
            const ts = shipyard?.timestamp ?? 0
            const delay = SHIPYARD_REFRESH_INTERVAL - ((new Date()).valueOf() - new Date(ts).valueOf())
            if (delay <= 0) {
                // console.log(`Refreshing shipyard ${waypoint_symbol}`)
                await universe.save_local_shipyard(await probe.refresh_shipyard())
                continue
            } else {
                // console.log(`Sleeping for ${delay}ms before refreshing shipyard ${waypoint_symbol}`)
                sleep_duration = Math.min(sleep_duration, delay)
            }
        }
        await new Promise(resolve => setTimeout(resolve, sleep_duration + 1000))
    }
}
