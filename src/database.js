
import { DB_URI } from './config.js'
import knex from 'knex'

const knex_config = {
  client: 'pg',
  connection: DB_URI,
  searchPath: ['public'],
  pool: {
    min: 1,
    max: 5,
  }
}

let _knex = null

class DB {
  static async init() {
    _knex = knex(knex_config)
    await _knex.raw('SELECT 1')
    console.log('connected to db')
  }
  static destroy() {
    _knex.destroy()
  }

  static async insert_market_trade(trade) {
    await _knex('market_trades').insert({
      timestamp: trade.timestamp,
      market_symbol: trade.market_symbol,
      symbol: trade.symbol,
      trade_volume: trade.tradeVolume,
      type: trade.type,
      supply: trade.supply,
      activity: trade.activity,
      purchase_price: trade.purchasePrice,
      sell_price: trade.sellPrice,
    })
  }

  static async upsert_market_transaction(transaction) {
    await _knex('market_transactions').insert({
      timestamp: transaction.timestamp,
      market_symbol: transaction.waypointSymbol,
      symbol: transaction.tradeSymbol,
      ship_symbol: transaction.shipSymbol,
      type: transaction.type,
      units: transaction.units,
      price_per_unit: transaction.pricePerUnit,
      total_price: transaction.totalPrice,
    }).onConflict(['market_symbol', 'timestamp']).ignore()
  }
}

export default DB
