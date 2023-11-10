
import Ship from './ship.js'

const ship = await Ship.new_fetch('SPACETIRADER-1')
await ship.flight_mode('CRUISE')

// await ship.refuel({maxFuelMissing: 1})
// await ship.navigate('X1-MU21-H51')
// await ship.refuel({maxFuelMissing: 1})

// await ship.buy_good('PLATINUM', 10)
// await ship.buy_good('PLATINUM', 10)
// await ship.buy_good('PLATINUM', 10)
// await ship.buy_good('PLATINUM', 5)

// await ship.navigate('X1-MU21-I55')

await ship.refuel({maxFuelMissing: 1})
await ship.dock()
await ship.supply_construction('X1-MU21-I54', 'PLATINUM', 35)

// await ship.refuel({maxFuelMissing: 1})
// await ship.navigate('X1-MU21-I54')
