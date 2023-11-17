import Universe from './universe.js'
import Agent from './agent.js'

const universe = await Universe.load()
const agent = await Agent.load(universe, '', 'WHYANDO')
const ship = agent.ship_controller('WHYANDO-1')

// await ship.navigate('X1-YY89-A2')
// await ship.wait_for_transit()
// await ship.refuel({maxFuelMissing: 1})
// await ship.sell_good('SHIP_PARTS', 35)

// await ship.jettison_all_cargo()

