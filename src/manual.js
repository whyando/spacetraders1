import Universe from './universe.js'
import Agent from './agent.js'
import DB from './database.js'

await DB.init()
const universe = await Universe.load()
const agent = await Agent.load(universe, '', 'WHYANDO')
universe.client.axiosInstance.defaults.headers['Authorization'] = `Bearer ${agent.token}`
const ship = agent.ship_controller('WHYANDO-16')

// WHYANDO-16 SHIP_EXPLORER: stuck
// WHYANDO-17 SHIP_EXPLORER: stuck
// WHYANDO-18 SHIP_EXPLORER: X1-JU88-A2
// WHYANDO-19 [X1-JU88] SHIP_PROBE
// WHYANDO-1A [X1-JU88] SHIP_LIGHT_HAULER
// WHYANDO-1B [X1-JU88] SHIP_LIGHT_HAULER
// WHYANDO-1C [X1-ZA74] SHIP_REFINING_FREIGHTER
// WHYANDO-1D [X1-ZA74] SHIP_PROBE

await ship.wait_for_transit()

console.log(ship.nav.waypointSymbol)
console.log(ship.fuel)
console.log(ship.cargo)

// await ship.flight_mode('CRUISE')
// await ship.warp('X1-JU88-A2')
// await ship.refuel({maxFuelMissing: 1})
// const waypoints = await ship.scan_waypoints()
// await universe.save_scanned_waypoints(waypoints)
// await universe.save_local_market(await ship.refresh_market())
// await universe.save_local_shipyard(await ship.refresh_shipyard())

// await agent.buy_ship('X1-JU88-A2', 'SHIP_PROBE')
// await agent.buy_ship('X1-JU88-A2', 'SHIP_LIGHT_HAULER')
// await agent.buy_ship('X1-JU88-A2', 'SHIP_LIGHT_HAULER')

await ship.flight_mode('DRIFT')
await ship.warp('X1-SH74-A2')
// await agent.buy_ship('X1-ZA74-C40', 'SHIP_PROBE')

DB.destroy()
console.log('done')

// await universe.get_remote_jumpgate_connections('X1-QY89-XA4Z')

// const c = await ship.negotiate_contract()
// console.log(JSON.stringify(c, null, 2))

// await ship.goto('X1-D48-DF2Z')
// await ship.refuel({maxFuelMissing: 1, fromCargo: true})
// await universe.save_local_market(await ship.refresh_market())


// await ship.refuel({minimum_fuel_level: 96, fromCargo: true})

// await ship.navigate('X1-AM81-ZF6D')
// await ship.refuel({maxFuelMissing: 1})
// await ship.buy_good('FUEL', 11)
// await universe.save_local_market(await ship.refresh_market())
// await universe.get_remote_jumpgate_connections('X1-TJ77-X11E')

// await ship.warp('X1-TJ77-CD1C')
// await universe.save_local_market(await ship.refresh_market())

// const route = [ 'X1-FJ85-BE7E' ]
// for (const symbol of route) {
//     await ship.jump(symbol)
// }
// await universe.get_remote_jumpgate_connections('X1-FJ85-BE7E')


// chart?

// await ship.navigate('X1-UP33-BB5A')
// await ship.wait_for_transit()

// await ship.refuel({maxFuelMissing: 1})
// await universe.save_local_market(await ship.refresh_market())

// [ 'X1-ZA74-I53', 'X1-CM53-I52', 'X1-QY89-XA4Z' ]

// await ship.warp('X1-ZA74-I53')
// await ship.wait_for_transit()
// await ship.refuel({maxFuelMissing: 1})


// console.log('transit complete')

// const waypoints = await ship.scan_waypoints()
// console.log(JSON.stringify(waypoints, null, 2))


// await ship.goto('X1-ZA74-A2')
// await ship.refuel({maxFuelMissing: 1})
// await universe.save_local_shipyard(await ship.refresh_shipyard())
// await universe.save_local_market(await ship.refresh_market())


