import fs from 'fs/promises'
import axios from 'axios'

const SPACETRADERS_TOKEN = (await fs.readFile('token.txt', 'utf8')).trim()
axios.defaults.headers.common['Authorization'] = `Bearer ${SPACETRADERS_TOKEN}`

const uri = 'https://api.spacetraders.io/v2/systems/X1-MU21/waypoints/X1-MU21-A2/shipyard'
const resp = await axios.get(uri)

await fs.writeFile('data/shipyards/X1-MU21-A2.json', JSON.stringify(resp.data.data,null,2))

