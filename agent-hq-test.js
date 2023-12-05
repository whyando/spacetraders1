
import axios from "axios"

const agents = []

for (let page = 1; page <= 10; page++) {
    const response = await axios.get(`https://api.spacetraders.io/v2/agents?limit=20&page=${page}`)
    agents.push(...response.data.data)
}

const s = new Set()
// console.log(agents)
agents.filter(a => a.startingFaction == 'COSMIC').forEach(a => s.add(a.headquarters))

console.log(Array.from(s).sort())

