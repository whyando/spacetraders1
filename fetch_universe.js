import fs from 'fs/promises';
import axios from 'axios';
import assert from 'assert';
import pThrottle from 'p-throttle';

axios.defaults.baseURL = 'https://api.spacetraders.io'

const throttle = pThrottle({
    limit: 1,
    interval: 550,
})

axios.interceptors.request.use(throttle(async config => {
    return config
}))


async function get_resource(file_path, uri, { paginated = false } = {}) {
    let exists;
    try {
        await fs.access(file_path);
        exists = true;
    } catch (error) {
        exists = false;
    }
    if (exists) {
        return JSON.parse(await fs.readFile(file_path, 'utf-8'));
    } else {
        let result;
        if (!paginated) {
            console.log(`GET ${uri}`)
            result = (await axios.get(uri)).data.data
        } else {
            result = []
            for (let page = 1;;page++) {
                console.log(`GET ${uri}?page=${page}`)
                const resp = (await axios.get(uri, { params: { page, limit: 20 } })).data
                result.push(...resp.data)
                if (resp.meta.page * 20 >= resp.meta.total) {
                    break
                }
            }
        }
        const dir = file_path.split('/').slice(0, -1).join('/')
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(file_path, JSON.stringify(result))
        return result
    }
}

const systems = await get_resource('./data/systems.json', '/v2/systems.json')
console.log(`${systems.length} systems`)

for (const s of systems) {
    const waypoints = await get_resource(`./data/system_waypoints/${s.symbol}.json`, `/v2/systems/${s.symbol}/waypoints`, {paginated: true})
    assert (waypoints.length == s.waypoints.length)
    s.waypoints = waypoints
    // console.log(`${s.symbol}: ${waypoints.length} waypoints`)
}
console.log(`waypoints: ${systems.map(s => s.waypoints.length).reduce((a, b) => a + b, 0)}`)

// find closest system to X1-MU21, that has a jumpgate
const x1 = systems.find(s => s.symbol == 'X1-YN8')
const jumpgates = systems.filter(s => s.waypoints.some(w => w.type == 'JUMP_GATE'))

const opt = []
for (const j of jumpgates) {
    const dist = Math.sqrt((j.x - x1.x) ** 2 + (j.y - x1.y) ** 2)
    opt.push({ distance: dist, system: j.symbol })
}
opt.sort((a, b) => a.distance - b.distance)

// opt.slice(0, 100).forEach(o => {
//     const s = systems.find(s => s.symbol == o.system)
//     const gate = s.waypoints.find(w => w.type == 'JUMP_GATE')
//     console.log({
//         waypoint: gate.symbol,
//         distance: o.distance,
//         constructed: !gate.isUnderConstruction,
//         faction: gate.faction?.symbol ?? 'none',
//     })
// })

const connections = ["X1-DU23-A12A","X1-XX80-C23X","X1-JH71-A10Z","X1-PK9-I64","X1-JM63-I60","X1-HQ56-C11C","X1-XT85-C26D","X1-VN41-A13D","X1-UH94-C19D","X1-BM69-I56","X1-CF7-X22Z"]
for (const conn of connections) {
    const system_symbol = conn.split('-').slice(0, 2).join('-')
    const o = opt.find(o => o.system == system_symbol)
    const s = systems.find(s => s.symbol == o.system)
    const gate = s.waypoints.find(w => w.type == 'JUMP_GATE')
    console.log({
        waypoint: gate.symbol,
        distance: o.distance,
        constructed: !gate.isUnderConstruction,
        faction: gate.faction?.symbol ?? 'none',
        sx: s.x,
        sy: s.y,
        wx: gate.x,
        wy: gate.y,
    })    
}

