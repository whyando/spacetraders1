import assert from 'assert'
import Resource from '../resource.js'

export default async function asteroid_controller_script(universe, agent, miners, haulers) {
    console.log(`asteroid_controller_script`);
    console.log(`extractors: ${extractors.map(x => x.symbol)}`);
    console.log(`haulers: ${haulers.map(x => x.symbol)}`);
    
    const asteroid_target = 'X1-YY89-B39'
    const asteroid_base_target = 'X1-YY89-B6'

    // miners
    while (true) {
        // miner
        for (const miner of miners) {
            await miner.navigate(asteroid_target, { wait: false })
        }

        // hauler
    }

    // haulers
    // recv transfer



    // 1. goto asteroid
    // 2. mine asteroid
    // 3. goto base
    // 4. sell

    throw new Error('not implemented')
}


// if (import.meta.url == `file://${process.argv[1]}`) {
//     const universe = await Universe.load()
//     const agent = await Agent.load(universe, null, 'WHYANDO')
//     const ship = agent.ship_controller('WHYANDO-1')

//     await asteroid_controller_script(universe, agent, [ship])
// }
