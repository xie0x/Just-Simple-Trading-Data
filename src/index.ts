import axios from "axios";
import fs from "fs-extra";

// ---------- Types ----------
interface TradingViewResponse {
  [key: string]: number | string | null;
}

type Recommendation = "Buy" | "Sell" | "Neutral";

interface PivotGroup {
  pp?: number | null;
  r1?: number | null;
  r2?: number | null;
  r3?: number | null;
  s1?: number | null;
  s2?: number | null;
  s3?: number | null;
}

interface PivotLevels {
  classic: PivotGroup;
  fibonacci: PivotGroup;
  camarilla: PivotGroup;
  woodie: PivotGroup;
  demark: PivotGroup;
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
  return `https://scanner.tradingview.com/symbol?symbol=${symbol}&fields=15,RSI|15,RSI[1]|15,Stoch.K|15,Stoch.D|15,Stoch.K[1]|15,Stoch.D[1]|15,CCI20|15,CCI20[1]|15,ADX|15,ADX+DI|15,ADX-DI|15,ADX+DI[1]|15,ADX-DI[1]|15,AO|15,AO[1]|15,AO[2]|15,Mom|15,Mom[1]|15,MACD.macd|15,MACD.signal|15,Rec.Stoch.RSI|15,Stoch.RSI.K|15,Rec.WR|15,W.R|15,Rec.BBPower|15,BBPower|15,Rec.UO|15,UO|15,EMA10|15,close|15,SMA10|15,EMA20|15,SMA20|15,EMA30|15,SMA30|15,EMA50|15,SMA50|15,EMA100|15,SMA100|15,EMA200|15,SMA200|15,Rec.Ichimoku|15,Ichimoku.BLine|15,Rec.VWMA|15,VWMA|15,Rec.HullMA9|15,HullMA9|15,Pivot.M.Classic.S3|15,Pivot.M.Classic.S2|15,Pivot.M.Classic.S1|15,Pivot.M.Classic.Middle|15,Pivot.M.Classic.R1|15,Pivot.M.Classic.R2|15,Pivot.M.Classic.R3|15,Pivot.M.Fibonacci.S3|15,Pivot.M.Fibonacci.S2|15,Pivot.M.Fibonacci.S1|15,Pivot.M.Fibonacci.Middle|15,Pivot.M.Fibonacci.R1|15,Pivot.M.Fibonacci.R2|15,Pivot.M.Fibonacci.R3|15,Pivot.M.Camarilla.S3|15,Pivot.M.Camarilla.S2|15,Pivot.M.Camarilla.S1|15,Pivot.M.Camarilla.Middle|15,Pivot.M.Camarilla.R1|15,Pivot.M.Camarilla.R2|15,Pivot.M.Camarilla.R3|15,Pivot.M.Woodie.S3|15,Pivot.M.Woodie.S2|15,Pivot.M.Woodie.S1|15,Pivot.M.Woodie.Middle|15,Pivot.M.Woodie.R1|15,Pivot.M.Woodie.R2|15,Pivot.M.Woodie.R3|15,Pivot.M.Demark.S1|15,Pivot.M.Demark.Middle|15,Pivot.M.Demark.R1|15,Pivot.M.HighLow.S3|15,Pivot.M.HighLow.S2|15,Pivot.M.HighLow.S1|15,Pivot.M.HighLow.Middle|15,Pivot.M.HighLow.R1|15,Pivot.M.HighLow.R2|15,Pivot.M.HighLow.R3&no_404=true`;
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
  const close = data["close|15"] as number | null;

  let recommendation: Recommendation = "Neutral";

  if (typeof rec === "number") {
    if (rec > 0) recommendation = "Buy";
    else if (rec < 0) recommendation = "Sell";
  } else if (typeof rsi === "number") {
    if (rsi > 70) recommendation = "Sell";
    else if (rsi < 30) recommendation = "Buy";
  }

  return { price: close, value: rsi ?? null, recommendation };
}

// ---------- EMA ----------
function analyzeEMA(data: TradingViewResponse): IndicatorWithPrice {
  const ema20 = data["EMA20|15"] as number | null;
  const close = data["close|15"] as number | null;

  let recommendation: Recommendation = "Neutral";
  if (ema20 !== null && close !== null) {
    if (close > ema20) recommendation = "Buy";
    else if (close < ema20) recommendation = "Sell";
  }

  return { price: close, value: ema20, recommendation };
}

// ---------- MACD ----------
function analyzeMACD(data: TradingViewResponse): IndicatorWithPrice {
  const macd = data["MACD.macd|15"] as number | null;
  const signal = data["MACD.signal|15"] as number | null;
  const close = data["close|15"] as number | null;

  let recommendation: Recommendation = "Neutral";
  if (macd !== null && signal !== null) {
    if (macd > signal) recommendation = "Buy";
    else if (macd < signal) recommendation = "Sell";
  }

  return { price: close, value: macd, recommendation };
}

// ---------- Stochastic ----------
function analyzeStoch(data: TradingViewResponse): IndicatorWithPrice {
  const k = data["Stoch.K|15"] as number | null;
  const d = data["Stoch.D|15"] as number | null;
  const close = data["close|15"] as number | null;

  let recommendation: Recommendation = "Neutral";
  if (k !== null && d !== null) {
    if (k > d && k < 80) recommendation = "Buy";
    else if (k < d && k > 20) recommendation = "Sell";
  }

  return { price: close, value: k, recommendation };
}

// ---------- ADX ----------
function analyzeADX(data: TradingViewResponse): IndicatorWithPrice {
  const adx = data["ADX|15"] as number | null;
  const plusDI = data["ADX+DI|15"] as number | null;
  const minusDI = data["ADX-DI|15"] as number | null;
  const close = data["close|15"] as number | null;

  let recommendation: Recommendation = "Neutral";
  if (adx !== null && plusDI !== null && minusDI !== null) {
    if (adx > 20 && plusDI > minusDI) recommendation = "Buy";
    if (adx > 20 && minusDI > plusDI) recommendation = "Sell";
  }

  return { price: close, value: adx, recommendation };
}

// ---------- CCI ----------
function analyzeCCI(data: TradingViewResponse): IndicatorWithPrice {
  const cci = data["CCI20|15"] as number | null;
  const close = data["close|15"] as number | null;

  let recommendation: Recommendation = "Neutral";
  if (cci !== null) {
    if (cci > 100) recommendation = "Buy";
    else if (cci < -100) recommendation = "Sell";
  }

  return { price: close, value: cci, recommendation };
}

// ---------- Williams %R ----------
function analyzeWillR(data: TradingViewResponse): IndicatorWithPrice {
  const willr = data["W.R|15"] as number | null;
  const close = data["close|15"] as number | null;

  let recommendation: Recommendation = "Neutral";
  if (willr !== null) {
    if (willr < -80) recommendation = "Buy";
    else if (willr > -20) recommendation = "Sell";
  }

  return { price: close, value: willr, recommendation };
}

// ---------- Bollinger Bands ----------
function analyzeBBands(data: TradingViewResponse): IndicatorWithPrice {
  const bbPower = data["BBPower|15"] as number | null;
  const close = data["close|15"] as number | null;

  let recommendation: Recommendation = "Neutral";
  if (bbPower !== null) {
    if (bbPower > 0) recommendation = "Buy";
    else if (bbPower < 0) recommendation = "Sell";
  }

  return { price: close, value: bbPower, recommendation };
}

// ---------- Pivot Points ----------
function calculatePivotPoints(
  data: Record<string, number | null>,
  high: number | null,
  low: number | null,
  priceNow: number | null
): PivotLevels {
  const classic: PivotGroup = {
    s3: data["Pivot.M.Classic.S3|15"] ?? null,
    s2: data["Pivot.M.Classic.S2|15"] ?? null,
    s1: data["Pivot.M.Classic.S1|15"] ?? null,
    pp: data["Pivot.M.Classic.Middle|15"] ?? null,
    r1: data["Pivot.M.Classic.R1|15"] ?? null,
    r2: data["Pivot.M.Classic.R2|15"] ?? null,
    r3: data["Pivot.M.Classic.R3|15"] ?? null,
  };

  const fibonacci: PivotGroup = {
    s3: data["Pivot.M.Fibonacci.S3|15"] ?? null,
    s2: data["Pivot.M.Fibonacci.S2|15"] ?? null,
    s1: data["Pivot.M.Fibonacci.S1|15"] ?? null,
    pp: data["Pivot.M.Fibonacci.Middle|15"] ?? null,
    r1: data["Pivot.M.Fibonacci.R1|15"] ?? null,
    r2: data["Pivot.M.Fibonacci.R2|15"] ?? null,
    r3: data["Pivot.M.Fibonacci.R3|15"] ?? null,
  };

  const camarilla: PivotGroup = {
    s3: data["Pivot.M.Camarilla.S3|15"] ?? null,
    s2: data["Pivot.M.Camarilla.S2|15"] ?? null,
    s1: data["Pivot.M.Camarilla.S1|15"] ?? null,
    pp: data["Pivot.M.Camarilla.Middle|15"] ?? null,
    r1: data["Pivot.M.Camarilla.R1|15"] ?? null,
    r2: data["Pivot.M.Camarilla.R2|15"] ?? null,
    r3: data["Pivot.M.Camarilla.R3|15"] ?? null,
  };

  const woodie: PivotGroup = {
    s3: data["Pivot.M.Woodie.S3|15"] ?? null,
    s2: data["Pivot.M.Woodie.S2|15"] ?? null,
    s1: data["Pivot.M.Woodie.S1|15"] ?? null,
    pp: data["Pivot.M.Woodie.Middle|15"] ?? null,
    r1: data["Pivot.M.Woodie.R1|15"] ?? null,
    r2: data["Pivot.M.Woodie.R2|15"] ?? null,
    r3: data["Pivot.M.Woodie.R3|15"] ?? null,
  };

  const demark: PivotGroup = {
    s1: data["Pivot.M.Demark.S1|15"] ?? null,
    pp: data["Pivot.M.Demark.Middle|15"] ?? null,
    r1: data["Pivot.M.Demark.R1|15"] ?? null,
  };

  const highLow = {
    high,
    low,
  };

  // --- Recommendation logic (simple: compare to Classic R1/S1) ---
  let recommendation: Recommendation = "Neutral";
  if (priceNow !== null) {
    if (classic.r1 !== null && priceNow > classic.r1) {
      recommendation = "Buy";
    } else if (classic.s1 !== null && priceNow < classic.s1) {
      recommendation = "Sell";
    }
  }

  return {
    classic,
    fibonacci,
    camarilla,
    woodie,
    demark,
    highLow,
    recommendation,
  };
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
    const file = "data/tradingdata_v02.json";
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
