import axios from "axios";
import fs from "fs-extra";

// ---------- Types ----------
interface TradingViewResponse {
  [key: string]: number | string | null;
}

type Recommendation = "Buy" | "Sell" | "Neutral";

interface PivotLevels {
  classic: Record<string, number>;
  fibonacci: Record<string, number>;
  camarilla: Record<string, number>;
  woodie: Record<string, number>;
  demark: Record<string, number>;
  highLow: { high: number | null; low: number | null };
  recommendation: Recommendation;
}

interface IndicatorResult {
  value: number | null;
  recommendation: Recommendation;
}

type IndicatorWithPrice = IndicatorResult & { price: number | null };

interface SymbolAnalysis {
  symbol: string;
  time: string;
  priceNow: number | null;
  hullma9: IndicatorWithPrice;
  rsi: IndicatorWithPrice;
  buySellDominance: { buy: number; sell: number };
  momentum: number | null;
  trend: number | null;
  volatility: number | null;
  ema: IndicatorWithPrice;
  macd: IndicatorWithPrice;
  stoch: IndicatorWithPrice;
  adx: IndicatorWithPrice;
  cci: IndicatorWithPrice;
  willr: IndicatorWithPrice;
  bbands: IndicatorWithPrice;
  pivotPoints: PivotLevels;
  finalSignal: {
    decision: Recommendation;
    confidence: Record<Recommendation, number>;
  };
  activeSessions: string[];
  marketStatus: "Open" | "Closed";
}

interface AggregateSummary {
  time: string;
  totalSymbols: number;
  buyPercent: number;
  sellPercent: number;
  neutralPercent: number;
  activeSessions: string[];
}

interface MarketSession {
  name: string;
  start: number; // hour in UTC
  end: number;   // hour in UTC
}

const sessions: MarketSession[] = [
  { name: "Tokyo", start: 0, end: 9 },     // 00:00–09:00 UTC
  { name: "London", start: 7, end: 16 },   // 07:00–16:00 UTC
  { name: "New York", start: 12, end: 21 } // 12:00–21:00 UTC
];

function getActiveSessions(date: Date): string[] {
  const utcHour = date.getUTCHours();
  return sessions
    .filter(s => (s.start <= utcHour && utcHour < s.end))
    .map(s => s.name);
}

// ---------- Market Hours (Open/Close)----------
interface MarketHours {
  open: number;  // UTC hour
  close: number; // UTC hour
  days?: number[]; // 0=Sun ... 6=Sat
}

const marketRules: Record<string, MarketHours | "24/7"> = {
  // Forex (approx)
  "forex": { open: 22, close: 22, days: [0,1,2,3,4] }, // Sun 22:00 → Fri 22:00 UTC
  // Crypto
  "crypto": "24/7",
  // Stocks (example: US)
  "us_stock": { open: 13, close: 20, days: [1,2,3,4,5] } // 13:30–20:00 UTC approx
};

function getSymbolType(symbol: string): "crypto" | "forex" | "us_stock" {
  if (symbol.endsWith("USDT")) return "crypto";
  if (/^[A-Z]{6}$/.test(symbol)) return "forex"; // e.g., EURUSD
  return "us_stock"; // fallback
}

function isMarketOpen(symbol: string, now: Date): boolean {
  const type = getSymbolType(symbol);
  const rule = marketRules[type];

  if (rule === "24/7") return true;

  const utcHour = now.getUTCHours();
  const day = now.getUTCDay();

  if (rule.days && !rule.days.includes(day)) return false;
  if (rule.open <= utcHour && utcHour < rule.close) return true;

  return false;
}

// ---------- Helpers ----------
const buildUrl = (symbol: string): string => {
  return `https://scanner.tradingview.com/symbol?symbol=${symbol}&fields=15,RSI|15,Mom|15,ADX|15,MACD.macd|15,MACD.signal|15,AO|15,Rec.RSI|15,Rec.HullMA9|15,HullMA9|15,close|15,high|15,low|15`;
};

// ---------- Dominance ----------
function calculateDominance(data: TradingViewResponse) {
  let buyScore = 0;
  let sellScore = 0;

  const rsi = data["RSI|15"] as number | null;
  if (typeof rsi === "number") {
    if (rsi > 70) sellScore += 25;
    else if (rsi < 30) buyScore += 25;
    else if (rsi > 50) buyScore += 15;
    else sellScore += 15;
  }

  const mom = data["Mom|15"] as number | null;
  if (typeof mom === "number") {
    if (mom > 0) buyScore += 25;
    else if (mom < 0) sellScore += 25;
  }

  const adx = data["ADX|15"] as number | null;
  if (typeof adx === "number") {
    if (adx > 20) {
      if (rsi && rsi > 50) buyScore += 25;
      else sellScore += 25;
    } else {
      buyScore += 10;
      sellScore += 10;
    }
  }

  const macd = data["MACD.macd|15"] as number | null;
  const signal = data["MACD.signal|15"] as number | null;
  if (typeof macd === "number" && typeof signal === "number") {
    if (macd > signal) buyScore += 25;
    else if (macd < signal) sellScore += 25;
  }

  const total = buyScore + sellScore;
  const buyPercent = total > 0 ? (buyScore / total) * 100 : 50;
  const sellPercent = total > 0 ? (sellScore / total) * 100 : 50;

  return {
    buy: parseFloat(buyPercent.toFixed(2)),
    sell: parseFloat(sellPercent.toFixed(2)),
  };
}

// ---------- Indicators ----------
// ---------- HullMA9 ----------
function analyzeHullMA9(data: TradingViewResponse): IndicatorWithPrice {
  const hullma9 = data["HullMA9|15"] as number | null;
  const close = data["close|15"] as number | null;

  if (hullma9 === null || close === null) {
    return { price: null, value: null, recommendation: "Neutral" };
  }

  if (close > hullma9) {
    return { price: hullma9, value: hullma9, recommendation: "Buy" };
  }
  if (close < hullma9) {
    return { price: hullma9, value: hullma9, recommendation: "Sell" };
  }
  return { price: hullma9, value: hullma9, recommendation: "Neutral" };
}

// ---------- RSI ----------
function analyzeRSI(data: TradingViewResponse): IndicatorWithPrice {
  const rsi = data["RSI|15"] as number | null;
  const rec = data["Rec.RSI|15"] as number | null;

  let recommendation: Recommendation = "Neutral";

  if (typeof rec === "number") {
    if (rec > 0) recommendation = "Buy";
    else if (rec < 0) recommendation = "Sell";
  } else if (typeof rsi === "number") {
    if (rsi > 70) recommendation = "Sell";
    else if (rsi < 30) recommendation = "Buy";
  }

  return { price: null, value: rsi ?? null, recommendation };
}

// ---------- EMA ----------
function analyzeEMA(data: TradingViewResponse): IndicatorWithPrice {
  // If you later fetch EMA values from API, replace null
  const ema = null; 
  return { price: null, value: ema, recommendation: "Neutral" };
}

// ---------- MACD ----------
function analyzeMACD(data: TradingViewResponse): IndicatorWithPrice {
  const macd = data["MACD.macd|15"] as number | null;
  const signal = data["MACD.signal|15"] as number | null;

  let recommendation: Recommendation = "Neutral";
  if (macd !== null && signal !== null) {
    if (macd > signal) recommendation = "Buy";
    else if (macd < signal) recommendation = "Sell";
  }

  return { price: null, value: macd, recommendation };
}

// ---------- Stochastic ----------
function analyzeStoch(data: TradingViewResponse): IndicatorWithPrice {
  // Placeholder until you fetch stoch values from API
  const stoch = null;
  return { price: null, value: stoch, recommendation: "Neutral" };
}

// ---------- ADX ----------
function analyzeADX(data: TradingViewResponse): IndicatorWithPrice {
  const adx = data["ADX|15"] as number | null;
  let recommendation: Recommendation = "Neutral";

  if (typeof adx === "number") {
    if (adx > 25) recommendation = "Buy";
    else if (adx < 20) recommendation = "Sell";
  }

  return { price: null, value: adx, recommendation };
}

// ---------- CCI ----------
function analyzeCCI(data: TradingViewResponse): IndicatorWithPrice {
  const cci = null; // later if API provides
  return { price: null, value: cci, recommendation: "Neutral" };
}

// ---------- Williams %R ----------
function analyzeWillR(data: TradingViewResponse): IndicatorWithPrice {
  const willr = null; // placeholder
  return { price: null, value: willr, recommendation: "Neutral" };
}

// ---------- Bollinger Bands ----------
function analyzeBBands(data: TradingViewResponse): IndicatorWithPrice {
  const bbands = null; // placeholder
  return { price: null, value: bbands, recommendation: "Neutral" };
}

// ---------- Pivot Points ----------
function calculatePivotPoints(
  high: number | null,
  low: number | null,
  close: number | null,
  priceNow: number | null
): PivotLevels {
  if (high === null || low === null || close === null) {
    return {
      classic: {},
      fibonacci: {},
      camarilla: {},
      woodie: {},
      demark: {},
      highLow: { high, low },
      recommendation: "Neutral",
    };
  }

  const pp = (high + low + close) / 3;
  const diff = high - low;

  const levels = {
    classic: { pp, r1: 2 * pp - low, s1: 2 * pp - high },
    fibonacci: { pp, r1: pp + 0.382 * diff, s1: pp - 0.382 * diff },
    camarilla: { pp, r1: close + diff * 1.1 / 12, s1: close - diff * 1.1 / 12 },
    woodie: { pp: (high + low + 2 * close) / 4, r1: (2 * pp - low), s1: (2 * pp - high) },
    demark: { pp: (high + low + 2 * close) / 4, r1: (2 * pp - low), s1: (2 * pp - high) },
    highLow: { high, low },
  };

  let recommendation: Recommendation = "Neutral";
  if (priceNow !== null) {
    if (priceNow > levels.classic.r1) recommendation = "Buy";
    else if (priceNow < levels.classic.s1) recommendation = "Sell";
  }

  return { ...levels, recommendation };
}

// ---------- Final Signal ----------
function buildFinalSignal(symbol: SymbolAnalysis): SymbolAnalysis["finalSignal"] {
  const votes: Recommendation[] = [
    symbol.hullma9.recommendation,
    symbol.rsi.recommendation,
    symbol.macd.recommendation,
    symbol.ema.recommendation,
    symbol.stoch.recommendation,
    symbol.adx.recommendation,
    symbol.cci.recommendation,
    symbol.willr.recommendation,
    symbol.bbands.recommendation,
    symbol.pivotPoints.recommendation,
  ];

  let weights: Record<Recommendation, number> = { Buy: 0, Sell: 0, Neutral: 0 };

  for (const vote of votes) {
    if (vote === "Buy") weights.Buy += 1;
    if (vote === "Sell") weights.Sell += 1;
    if (vote === "Neutral") weights.Neutral += 1;
  }

  weights.Buy += symbol.rsi.recommendation === "Buy" ? 2 : 0;
  weights.Sell += symbol.rsi.recommendation === "Sell" ? 2 : 0;
  weights.Buy += symbol.hullma9.recommendation === "Buy" ? 2 : 0;
  weights.Sell += symbol.hullma9.recommendation === "Sell" ? 2 : 0;

  const total = weights.Buy + weights.Sell + weights.Neutral;
  const confidence = {
    Buy: parseFloat(((weights.Buy / total) * 100).toFixed(2)),
    Sell: parseFloat(((weights.Sell / total) * 100).toFixed(2)),
    Neutral: parseFloat(((weights.Neutral / total) * 100).toFixed(2)),
  };

  const decision: Recommendation =
    confidence.Buy > confidence.Sell && confidence.Buy > confidence.Neutral
      ? "Buy"
      : confidence.Sell > confidence.Buy && confidence.Sell > confidence.Neutral
      ? "Sell"
      : "Neutral";

  return { decision, confidence };
}

// ---------- Analysis Builder ----------
function analyzeSymbol(symbol: string, data: TradingViewResponse): SymbolAnalysis {
  const high = (data["high|15"] as number) ?? null;
  const low = (data["low|15"] as number) ?? null;
  const close = (data["close|15"] as number) ?? null;
  const priceNow = close;
  const newTime: string = new Date().toISOString();
  const dateObj = new Date(newTime);

  const result: SymbolAnalysis = {
    symbol,
    time: new Date().toISOString(),
    priceNow,
    hullma9: analyzeHullMA9(data),
    rsi: analyzeRSI(data),
    buySellDominance: calculateDominance(data),
    momentum: (data["Mom|15"] as number) ?? null,
    trend: (data["ADX|15"] as number) ?? null,
    volatility: (data["AO|15"] as number) ?? null,
    ema: analyzeEMA(data),
    macd: analyzeMACD(data),
    stoch: analyzeStoch(data),
    adx: analyzeADX(data),
    cci: analyzeCCI(data),
    willr: analyzeWillR(data),
    bbands: analyzeBBands(data),
    pivotPoints: calculatePivotPoints(high, low, close, priceNow),
    finalSignal: { decision: "Neutral", confidence: { Buy: 0, Sell: 0, Neutral: 100 } },
    activeSessions: getActiveSessions(dateObj),
    marketStatus: isMarketOpen(symbol, dateObj) ? "Open" : "Closed"
  };

  result.finalSignal = buildFinalSignal(result);
  return result;
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
  const newTime: string = new Date().toISOString();
  const dateObj = new Date(newTime);

  return {
    time: new Date().toISOString(),
    totalSymbols: results.length,
    buyPercent: parseFloat(buyPercent.toFixed(2)),
    sellPercent: parseFloat(sellPercent.toFixed(2)),
    neutralPercent: parseFloat(neutralPercent.toFixed(2)),
    activeSessions: getActiveSessions(dateObj)
  };
}

// ---------- Main ----------
const main = async (): Promise<void> => {
  try {
    const symbols = [
      "CRYPTO:BTCUSD",
      "CRYPTO:ETHUSD",
      "CRYPTO:BNBUSD",
      "OANDA:XAUUSD",
      "CRYPTO:SOLUSD",
      "CRYPTO:HYPEHUSD",
      "CRYPTO:XRPUSD",
      "CRYPTO:SUIUSD",
    ];
    const results: SymbolAnalysis[] = [];

    for (const symbol of symbols) {
      const { data } = await axios.get<TradingViewResponse>(buildUrl(symbol));
      results.push(analyzeSymbol(symbol, data));
    }

    const aggregate = buildAggregateSummary(results);

    // code version: 0.2
    const file = "data/tradingdata_v02_1.json";
    let history: { symbols: SymbolAnalysis[]; summary: AggregateSummary }[] = [];

    if (await fs.pathExists(file)) {
      history = await fs.readJson(file);
    }

    history.push({ symbols: results, summary: aggregate });

    await fs.writeJson(file, history, { spaces: 2 });
  } catch (err) {
    console.error(err);
    throw new Error("Failed to fetch data from TradingView API");
  }
};

// Run
main();
