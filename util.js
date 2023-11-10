import assert from 'assert'

export const sys = (waypoint) => {
    const p = waypoint.split('-')
    assert(p.length == 3)
    return p.slice(0, 2).join('-')
}
