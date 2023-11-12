import fs from 'fs'

const resources = {}

export default class Resource {
    constructor(file_path, data) {
        this.file_path = file_path
        this.data = data
    }

    static get(file_path, default_data = {}) {
        if (resources[file_path]) {
            return resources[file_path]
        }
        let data
        try {
            data = JSON.parse(fs.readFileSync(file_path, 'utf-8'))
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

    save() {
        fs.mkdirSync(this.file_path.split('/').slice(0, -1).join('/'), { recursive: true })
        fs.writeFileSync(this.file_path, JSON.stringify(this.data, null, 2) + '\n')
    }
}

if (import.meta.url == `file://${process.argv[1]}`) {
    const resource = Resource.get('data/test.json')
    const resource1 = Resource.get('data/test.json')
    resource.data.x = (resource.data.x ?? 0) + 1
    console.log(resource.data)
    console.log(resource1.data)
    resource.save()
}
