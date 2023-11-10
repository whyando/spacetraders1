import fs from 'fs/promises'
import assert from 'assert'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'

import Ship from './ship.js'

// b8 - iron ore
// b7 - iron ore again
// j84?

const GAS_GIANT = 'X1-MU21-C34'
const ASTEROID = 'X1-MU21-J84'
const ASTEROID_BASE = 'X1-MU21-B6'

const ship = await Ship.new_fetch('SPACETIRADER-4')
console.log(`ship: ${JSON.stringify(ship)}`)
console.log(`cargo: ${JSON.stringify(ship.cargo)}`)
console.log(`fuel: ${JSON.stringify(ship.fuel)}`)

// // load all surveys
// const surveys = []
// for (const file of await fs.readdir('data/surveys')) {
//     const survey = JSON.parse(await fs.readFile(`data/surveys/${file}`, 'utf8'))
//     console.log(`survey: ${JSON.stringify(survey)}`)
//     surveys.push(survey)
// }

// const survey = surveys.filter(s => s.symbol == ASTEROID)[0]

// await ship.flight_mode('DRIFT')
// await ship.navigate(ASTEROID)
// {
//     const surveys = await ship.survey()
//     for (const s of surveys) {
//         const uuid = uuidv4()
//         await fs.writeFile(`data/surveys/${uuid}.json`, JSON.stringify(s))
//     }
// }

while (false) {
    await ship.flight_mode('DRIFT')
    await ship.navigate(ASTEROID)
    await ship.wait_for_transit()
    while (ship.cargo.capacity - ship.cargo.units > 0) {
        // await ship.extract_survey(survey)
        await ship.extract()
    }
    console.log(`cargo: ${JSON.stringify(ship.cargo)}`)

    await ship.flight_mode('DRIFT')
    await ship.navigate(ASTEROID_BASE)
    await ship.wait_for_transit()
    await ship.refuel({maxFuelMissing: 99})

    await ship.sell_good('IRON_ORE', 35)
}
await ship.jettison_all('LIQUID_HYDROGEN')
await ship.jettison_all('HYDROCARBON')
await ship.jettison_all('LIQUID_NITROGEN')

await ship.navigate(GAS_GIANT)
await ship.wait_for_transit()
while (ship.cargo.capacity - ship.cargo.units > 0) {
    // await ship.extract_survey(survey)
    await ship.siphon()
}
console.log(`cargo: ${JSON.stringify(ship.cargo)}`)
