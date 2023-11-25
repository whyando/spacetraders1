import assert from 'assert'
import DB from './database.js'

class Analytics {
    static async record_market(market) {
        assert(market.timestamp)
        for (const good of market.tradeGoods) {
            const trade = {
                timestamp: market.timestamp,
                market_symbol: market.symbol,
                ...good,
            }
            await DB.insert_market_trade(trade)
        }
        for (const t of market.transactions) {
            await DB.upsert_market_transaction(t)
        }
    }
}

export default Analytics
