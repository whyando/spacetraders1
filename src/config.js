import dotenv from "dotenv";

dotenv.config()

export const DB_URI = process.env.DB_URI

if (!DB_URI) {
    throw new Error('DB_URI not set')
}
