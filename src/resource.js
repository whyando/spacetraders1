import fs from 'fs/promises'

const resources = {}

export default class Resource {
    constructor(file_path, data) {
        this.file_path = file_path
        this.data = data
    }

    static async get(file_path, default_data = {}) {
        if (resources[file_path]) {
            return resources[file_path]
        }
        let data
        try {
            data = JSON.parse(await fs.readFile(file_path, 'utf-8'))
        } catch (error) {
            // make sure error is a file not found error
            if (error.code != 'ENOENT') {
                throw error
            }
            data = default_data
        }
        const resource = new Resource(file_path, data)
        resources[file_path] = resource
        return resource
    }

    async save() {
        await fs.mkdir(this.file_path.split('/').slice(0, -1).join('/'), { recursive: true })
        await fs.writeFile(this.file_path, JSON.stringify(this.data, null, 2) + '\n')
    }
}

if (import.meta.url == `file://${process.argv[1]}`) {
    const resource = await Resource.get('data/test.json')
    const resource1 = await Resource.get('data/test.json')
    resource.data.x = (resource.data.x ?? 0) + 1
    console.log(resource.data)
    console.log(resource1.data)
    await resource.save()
}

