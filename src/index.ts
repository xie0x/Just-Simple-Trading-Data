import axios from "axios";
import fs from "fs-extra";

// ---------- Types ----------
interface TradingViewResponse {
  [key: string]: number | string | null;
}

interface SymbolAnalysis {
  symbol: string;
  time: string;
  hullma9: {
    price: number | null;
    recommendation: "Buy" | "Sell" | "Neutral";
  };
  rsiRecommendation: number | null;
  buySellDominance: {
    buy: number;   // %
    sell: number;  // %
  };
  momentum: number | null;
  trend: number | null;
  volatility: number | null;
}

interface AggregateSummary {
  time: string;
  totalSymbols: number;
  buyPercent: number;
  sellPercent: number;
  neutralPercent: number;
}

// ---------- Helpers ----------
const buildUrl = (symbol: string): string => {
  return `https://scanner.tradingview.com/symbol?symbol=${symbol}&fields=15,RSI|15,Mom|15,ADX|15,MACD.macd|15,MACD.signal|15,AO|15,Rec.RSI|15,Rec.HullMA9|15,HullMA9|15,close|15&no_404=true`;
};

// ---------- Buy/Sell Dominance Logic ----------
function calculateDominance(data: TradingViewResponse) {
  let buyScore = 0;
  let sellScore = 0;

  // RSI logic
  const rsi = data["RSI|15"] as number | null;
  if (typeof rsi === "number") {
    if (rsi > 70) sellScore += 25;
    else if (rsi < 30) buyScore += 25;
    else if (rsi > 50) buyScore += 15;
    else sellScore += 15;
  }

  // Momentum
  const mom = data["Mom|15"] as number | null;
  if (typeof mom === "number") {
    if (mom > 0) buyScore += 25;
    else if (mom < 0) sellScore += 25;
  }

  // ADX
  const adx = data["ADX|15"] as number | null;
  if (typeof adx === "number") {
    if (adx > 20) {
      if (rsi && rsi > 50) buyScore += 25;
      else sellScore += 25;
    } else {
      // weak trend → neutral contribution
      buyScore += 10;
      sellScore += 10;
    }
  }

  // MACD
  const macd = data["MACD.macd|15"] as number | null;
  const signal = data["MACD.signal|15"] as number | null;
  if (typeof macd === "number" && typeof signal === "number") {
    if (macd > signal) buyScore += 25;
    else if (macd < signal) sellScore += 25;
  }

  // Normalize to %
  const total = buyScore + sellScore;
  const buyPercent = total > 0 ? (buyScore / total) * 100 : 50;
  const sellPercent = total > 0 ? (sellScore / total) * 100 : 50;

  return {
    buy: parseFloat(buyPercent.toFixed(2)),
    sell: parseFloat(sellPercent.toFixed(2)),
  };
}

// ---------- HullMA9 Recommendation ----------
function analyzeHullMA9(data: TradingViewResponse): {
  price: number | null;
  recommendation: "Buy" | "Sell" | "Neutral";
} {
  const hullma9 = data["HullMA9|15"] as number | null;
  const close = data["close|15"] as number | null;

  if (hullma9 === null || close === null) {
    return { price: null, recommendation: "Neutral" };
  }

  if (close > hullma9) return { price: hullma9, recommendation: "Buy" };
  if (close < hullma9) return { price: hullma9, recommendation: "Sell" };
  return { price: hullma9, recommendation: "Neutral" };
}

// ---------- Analysis Builder ----------
function analyzeSymbol(symbol: string, data: TradingViewResponse): SymbolAnalysis {
  return {
    symbol,
    time: new Date().toISOString(),
    hullma9: analyzeHullMA9(data),
    rsiRecommendation: (data["Rec.RSI|15"] as number) ?? null,
    buySellDominance: calculateDominance(data),
    momentum: (data["Mom|15"] as number) ?? null,
    trend: (data["ADX|15"] as number) ?? null,
    volatility: (data["AO|15"] as number) ?? null,
  };
}

// ---------- Aggregate Summary ----------
function buildAggregateSummary(results: SymbolAnalysis[]): AggregateSummary {
  let totalBuy = 0;
  let totalSell = 0;

  for (const r of results) {
    totalBuy += r.buySellDominance.buy;
    totalSell += r.buySellDominance.sell;
  }

  const total = totalBuy + totalSell;
  const buyPercent = total > 0 ? (totalBuy / total) * 100 : 0;
  const sellPercent = total > 0 ? (totalSell / total) * 100 : 0;
  const neutralPercent = 100 - buyPercent - sellPercent;

  return {
    time: new Date().toISOString(),
    totalSymbols: results.length,
    buyPercent: parseFloat(buyPercent.toFixed(2)),
    sellPercent: parseFloat(sellPercent.toFixed(2)),
    neutralPercent: parseFloat(neutralPercent.toFixed(2)),
  };
}

// ---------- Main Function ----------
const main = async (): Promise<void> => {
  try {
    const symbols = ["CRYPTO:BTCUSD", "CRYPTO:ETHUSD", "CRYPTO:BNBUSD", "OANDA:XAUUSD", "CRYPTO:SOLUSD", "CRYPTO:HYPEHUSD", "CRYPTO:XRPUSD", "CRYPTO:SUIUSD"]; // extend as needed
    const results: SymbolAnalysis[] = [];

    for (const symbol of symbols) {
      const { data } = await axios.get<TradingViewResponse>(buildUrl(symbol));
      results.push(analyzeSymbol(symbol, data));
    }

    const aggregate = buildAggregateSummary(results);

    const file = "tradingdata.json";
    let history: { symbols: SymbolAnalysis[]; summary: AggregateSummary }[] = [];

    if (await fs.pathExists(file)) {
      history = await fs.readJson(file);
    }

    history.push({
      symbols: results,
      summary: aggregate,
    });

    await fs.writeJson(file, history, { spaces: 2 });
  } catch (err) {
    console.error(err);
    throw new Error("Failed to fetch data from TradingView API");
  }
};

// Run
main();
