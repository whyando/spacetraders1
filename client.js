import axios from 'axios'
import fs from 'fs/promises'

import pThrottle from 'p-throttle'

const throttle = pThrottle({
    limit: 1,
    interval: 500,
})

export default class Client {

    axiosInstance = null

    constructor(token=null) {
        const headers = {}
        if (token) {
            headers["Authorization"] = `Bearer ${token}`
        }
        this.axiosInstance = axios.create({
            baseURL: 'https://api.spacetraders.io',
            headers,
        })
    }

    async get(uri, params={}) {
        return await (throttle(async () => this.axiosInstance.get(uri, params)))()
    }

    async post(uri, data={}, params={}) {
        return await (throttle(async () => this.axiosInstance.post(uri, data, params)))()
    }

    async put(uri, data={}, params={}) {
        return await (throttle(async () => this.axiosInstance.put(uri, data, params)))()
    }

    async delete(uri, params={}) {
        return await (throttle(async () => this.axiosInstance.delete(uri, params)))()
    }

    async patch(uri, data={}, params={}) {
        return await (throttle(async () => this.axiosInstance.patch(uri, data, params)))()
    }
    
    async load_resource(file_path, uri, {
        paginated = false,
        map_fn = (i) => i,
        file_path_fn = null,
        always_fetch = false,
    } = {}
    ) {        
        let exists;
        try {
            await fs.access(file_path);
            exists = true;
        } catch (error) {
            exists = false;
        }
        if (exists && !always_fetch) {
            return JSON.parse(await fs.readFile(file_path, 'utf-8'));
        } else {
            let result;
            if (!paginated) {                
                console.log(`GET ${uri}`)
                result = map_fn((await this.get(uri)).data)
            } else {
                result = []
                for (let page = 1;;page++) {
                    console.log(`GET ${uri}?page=${page}`)
                    const resp = (await this.get(uri, { params: { page, limit: 20 } })).data
                    result.push(...resp.data)
                    if (resp.meta.page * 20 >= resp.meta.total) {
                        break
                    }
                }
            }

            if (file_path_fn != null) {
                for (const item of result) {
                    const file_path = file_path_fn(item)
                    const dir = file_path.split('/').slice(0, -1).join('/')
                    await fs.mkdir(dir, { recursive: true })
                    await fs.writeFile(file_path, JSON.stringify(item, null, 2))
                }
            } else {
                const dir = file_path.split('/').slice(0, -1).join('/')
                await fs.mkdir(dir, { recursive: true })
                await fs.writeFile(file_path, JSON.stringify(result, null, 2))
            }
            return result
        }
    }
}
