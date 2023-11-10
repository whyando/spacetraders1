
import Ship from './ship.js'
import Agent from './agent.js'

await Agent.load('SPACETIRADER')
const ship = await Ship.new_fetch('SPACETIRADER-1')

await ship.jump('X1-VN41-A13D')
