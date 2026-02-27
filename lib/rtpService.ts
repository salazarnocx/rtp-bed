// lib/rtpService.ts
import { supabaseAdmin } from "./supabaseAdmin";
import { generateRtpRange, generateWindow } from "./randomRtp";
import { ProviderCode, SpeedMode, SpinMode } from "./spinConfig";
import { generateSpinPattern, SpinPattern } from "./spinGenerator";

export type GameRow = {
  id: string;
  slug: string;
  display_name: string;
  provider: ProviderCode;
  has_marks: boolean;
  has_dc: boolean;
  has_buy_spin: boolean;
  is_active: boolean;
  display_order: number | null;
};

export type GameStateRow = {
  game_id: string;
  rtp_min: number;
  rtp_max: number;
  window_start: string;
  window_end: string;
  spin_mode: SpinMode;
  spin_count: number | null;
  speed: SpeedMode | null;
  mark1: boolean | null;
  mark2: boolean | null;
  mark3: boolean | null;
  dc_on: boolean | null;
  buy_spin_recommend: boolean | null;
};

export type WinSimulationItem = {
  user: string; // contoh: P*****6
  label: string; // contoh: Mega Win
  amount: number; // integer rupiah
};

export type GameWithState = GameRow & {
  rtp_min: number;
  rtp_max: number;
  window_start: string;
  window_end: string;
  spin_mode: SpinMode;
  spin_count: number | null;
  speed: SpeedMode | null;
  mark1: boolean | null;
  mark2: boolean | null;
  mark3: boolean | null;
  dc_on: boolean | null;
  buy_spin_recommend: boolean | null;

  // ✅ “live probabilitas kemenangan” (simulasi, deterministik per state/window)
  win_simulations: WinSimulationItem[];
};

// Supabase sering “cap” max rows = 1000 per request.
// Jadi kita paginate aman pakai size <= 1000.
const SUPABASE_PAGE_SIZE = 1000;

// ======================
// Win simulation (deterministik per state)
// ======================
type WinRule =
  | {
      kind: "RANGE";
      label: string;
      weight: number;
      min: number;
      max: number;
      skew?: number; // makin besar => makin berat ke nilai kecil
      roundTo?: number;
    }
  | {
      kind: "PP_MAXWIN";
      label: "Maxwin";
      weight: number;
    };

type ProviderWinConfig = {
  minItems: number;
  maxItems: number;
  rules: WinRule[];
  defaultSkew: number;
  defaultRoundTo: number;
};

function hashStringTo32(str: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number) {
  const r = rng();
  return min + Math.floor(r * (max - min + 1));
}

function pickWeighted<T extends { weight: number }>(rng: () => number, items: T[]): T {
  const total = items.reduce((s, it) => s + it.weight, 0);
  const r = rng() * total;
  let acc = 0;
  for (const it of items) {
    acc += it.weight;
    if (r <= acc) return it;
  }
  return items[items.length - 1];
}

function skewedBetween(rng: () => number, min: number, max: number, skew: number) {
  // u^skew => condong ke kecil (skew > 1)
  const u = rng();
  const t = Math.pow(u, skew);
  return min + (max - min) * t;
}

function roundToStep(n: number, step: number) {
  if (step <= 1) return Math.round(n);
  return Math.round(n / step) * step;
}

function genMaskedUser(rng: () => number) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const first = alpha[randInt(rng, 0, alpha.length - 1)];
  const stars = "*".repeat(randInt(rng, 4, 6));
  const lastIsDigit = rng() < 0.6;
  const last = lastIsDigit ? String(randInt(rng, 0, 9)) : alpha[randInt(rng, 0, alpha.length - 1)];
  return `${first}${stars}${last}`;
}

// ===== Pragmatic Maxwin special rules =====
const PP_MAXWIN_15000_SLUGS = new Set(
  [
    "pp-olymp-1000",
    "pp-str-p-1000",
    "pp-gogk-1000",
    "pp-swt-bz-1000",
    "pp-sarcher-1000",
    "pp-sgr-r-1000",
    "pp-woa-1000",
    "pp-woa-1000-x",
    "pp-swt-bz-1000d",
    "pp-olymp-1000d",
  ].map((s) => s.toLowerCase())
);

function isPpMaxwin15000(slug: string) {
  return PP_MAXWIN_15000_SLUGS.has((slug || "").toLowerCase());
}

function getPragmaticMaxwinMultipliers(slug: string) {
  if (isPpMaxwin15000(slug)) {
    // fix 15.000x
    return [{ m: 15000, weight: 100 }];
  }

  // default pragmatic lainnya
  return [
    { m: 10000, weight: 22 },
    { m: 21000, weight: 8 },
  ];
}

// Maxwin = bet (min 200, kelipatan 200) * multiplier
// “semakin besar makin kecil” => skew bet condong ke kecil
function genPragmaticMaxwin(rng: () => number, slug: string) {
  const BET_MIN = 400;
  const BET_MAX = 5000; // asumsi wajar, bisa kamu naikkan kalau mau
  const STEP = 200;

  const steps = Math.floor((BET_MAX - BET_MIN) / STEP); // 0..steps
  const stepPick = Math.floor(Math.pow(rng(), 2.8) * (steps + 1));
  const bet = BET_MIN + Math.min(steps, stepPick) * STEP;

  const multipliers = getPragmaticMaxwinMultipliers(slug);
  const picked = pickWeighted(rng, multipliers);

  return bet * picked.m;
}

const WIN_CONFIG: Record<string, ProviderWinConfig> = {
  // Pragmatic Play
  pp: {
    minItems: 5,
    maxItems: 8,
    defaultSkew: 2.6,
    defaultRoundTo: 1000,
    rules: [
      { kind: "RANGE", label: "Mega Win", weight: 45, min: 300_000, max: 1_000_000, skew: 2.3 },
      { kind: "RANGE", label: "Super Win", weight: 35, min: 500_000, max: 1_800_000, skew: 2.7 },
      { kind: "RANGE", label: "Sensational", weight: 25, min: 800_000, max: 3_000_000, skew: 3.0 },
      { kind: "PP_MAXWIN", label: "Maxwin", weight: 5 },
    ],
  },

  // PG Soft
  pg: {
    minItems: 5,
    maxItems: 8,
    defaultSkew: 2.6,
    defaultRoundTo: 1000,
    rules: [
      { kind: "RANGE", label: "Mega Win", weight: 55, min: 350_000, max: 1_500_000, skew: 2.4 },
      { kind: "RANGE", label: "Super Win", weight: 35, min: 800_000, max: 3_500_000, skew: 2.9 },
      { kind: "RANGE", label: "Super Mega Win", weight: 10, min: 2_500_000, max: 50_000_000, skew: 3.6, roundTo: 5000 },
    ],
  },

  // Slot88
  slot88: {
    minItems: 5,
    maxItems: 8,
    defaultSkew: 2.6,
    defaultRoundTo: 1000,
    rules: [
      { kind: "RANGE", label: "Mega Win", weight: 55, min: 300_000, max: 1_000_000, skew: 2.4 },
      { kind: "RANGE", label: "Super Win", weight: 35, min: 600_000, max: 2_000_000, skew: 2.9 },
      { kind: "RANGE", label: "Grand Jackpot", weight: 10, min: 1_500_000, max: 40_000_000, skew: 3.6, roundTo: 5000 },
    ],
  },

  // JILI
  jili: {
    minItems: 5,
    maxItems: 8,
    defaultSkew: 2.6,
    defaultRoundTo: 1000,
    rules: [
      { kind: "RANGE", label: "Mega Win", weight: 55, min: 300_000, max: 1_200_000, skew: 2.4 },
      { kind: "RANGE", label: "Super Win", weight: 35, min: 500_000, max: 2_400_000, skew: 2.9 },
      { kind: "RANGE", label: "Fantastic", weight: 10, min: 2_000_000, max: 45_000_000, skew: 3.6, roundTo: 5000 },
    ],
  },

  // Microgaming
  microgaming: {
    minItems: 5,
    maxItems: 8,
    defaultSkew: 2.6,
    defaultRoundTo: 1000,
    rules: [
      { kind: "RANGE", label: "Mega Win", weight: 55, min: 400_000, max: 1_600_000, skew: 2.4 },
      { kind: "RANGE", label: "Epic Win", weight: 35, min: 800_000, max: 3_200_000, skew: 2.9 },
      { kind: "RANGE", label: "Mega Moolah", weight: 10, min: 2_500_000, max: 30_000_000, skew: 3.6, roundTo: 5000 },
    ],
  },

  // Spadegaming
  spadegaming: {
    minItems: 5,
    maxItems: 8,
    defaultSkew: 2.6,
    defaultRoundTo: 1000,
    rules: [
      { kind: "RANGE", label: "Mega Win", weight: 55, min: 350_000, max: 1_500_000, skew: 2.4 },
      { kind: "RANGE", label: "Super Win", weight: 35, min: 750_000, max: 2_900_000, skew: 2.9 },
      { kind: "RANGE", label: "Ultimate Win", weight: 10, min: 2_400_000, max: 35_000_000, skew: 3.6, roundTo: 5000 },
    ],
  },
};

function getProviderConfig(providerKey: string): ProviderWinConfig | null {
  const key = (providerKey || "").toLowerCase();
  return WIN_CONFIG[key] ?? null;
}

function generateWinSimulations(game: GameRow, state: GameStateRow): WinSimulationItem[] {
  const providerKey = String(game.provider).toLowerCase();
  const cfg = getProviderConfig(providerKey);
  if (!cfg) return [];

  // deterministik: berubah hanya ketika window/state berubah
  const seed = hashStringTo32(`${game.id}|${state.window_start}|${state.window_end}|wins|${providerKey}`);
  const rng = mulberry32(seed);

  const count = randInt(rng, cfg.minItems, cfg.maxItems);
  const out: WinSimulationItem[] = [];

  for (let i = 0; i < count; i++) {
    const rule = pickWeighted(rng, cfg.rules);

    let amount = 0;
    if (rule.kind === "PP_MAXWIN") {
      // pragmatic only
      amount = genPragmaticMaxwin(rng, game.slug);
    } else {
      const skew = rule.skew ?? cfg.defaultSkew;
      const roundTo = rule.roundTo ?? cfg.defaultRoundTo;
      const raw = skewedBetween(rng, rule.min, rule.max, skew);
      amount = roundToStep(raw, roundTo);
    }

    out.push({
      user: genMaskedUser(rng),
      label: rule.label,
      amount: Math.max(0, Math.floor(amount)),
    });
  }

  return out.slice(0, cfg.maxItems);
}

async function fetchAllActiveGames(): Promise<GameRow[]> {
  const all: GameRow[] = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;

    const { data, error } = await supabaseAdmin
      .from("games")
      .select("id, slug, display_name, provider, has_marks, has_dc, has_buy_spin, is_active, display_order")
      .eq("is_active", true)
      // penting: order stabil supaya pagination konsisten
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("display_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as GameRow[];
    all.push(...rows);

    if (rows.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return all;
}

async function fetchAllGameStates(): Promise<GameStateRow[]> {
  const all: GameStateRow[] = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;

    const { data, error } = await supabaseAdmin
      .from("game_rtp_state")
      .select("*")
      .order("game_id", { ascending: true })
      .range(from, to);

    if (error) {
      console.error("Failed to fetch game_rtp_state", error);
      break;
    }

    const rows = (data ?? []) as GameStateRow[];
    all.push(...rows);

    if (rows.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return all;
}

// helper untuk bikin state baru dari sebuah "base time"
function createRandomState(baseTime: Date, game: GameRow): GameStateRow {
  const { rtp_min, rtp_max } = generateRtpRange();
  const { window_start, window_end } = generateWindow(baseTime);

  const spinPattern: SpinPattern = generateSpinPattern({
    provider: game.provider,
    hasMarks: game.has_marks,
    hasDc: game.has_dc,
    hasBuySpin: game.has_buy_spin,
  });

  return {
    game_id: game.id,
    rtp_min,
    rtp_max,
    window_start: window_start.toISOString(),
    window_end: window_end.toISOString(),
    ...spinPattern,
  };
}

export async function getGamesWithCurrentRtp(): Promise<GameWithState[]> {
  const now = new Date();

  // 1) ambil semua game aktif (paginate)
  const gameRows = await fetchAllActiveGames();
  if (gameRows.length === 0) return [];

  // 2) ambil state RTP existing (paginate)
  const states = await fetchAllGameStates();

  const stateMap = new Map<string, GameStateRow>();
  (states ?? []).forEach((s) => stateMap.set(s.game_id, s as GameStateRow));

  const results: GameWithState[] = [];
  const upserts: GameStateRow[] = [];

  for (const game of gameRows) {
    const existing = stateMap.get(game.id);
    let newState: GameStateRow | null = null;
    let stateToUse: GameStateRow;

    if (!existing) {
      // belum ada state → generate pertama kali, base = sekarang
      const initial = createRandomState(now, game);
      newState = initial;
      stateToUse = initial;
    } else {
      const nowMs = now.getTime();
      let latest = existing;

      let endMs = new Date(latest.window_end).getTime();
      if (!Number.isFinite(endMs)) endMs = 0;

      if (endMs <= nowMs) {
        // window sudah lewat → generate berulang sampai dapat window_end > now
        const MAX_ITER = 32;
        let iter = 0;

        let baseTime = new Date(latest.window_end);
        if (Number.isNaN(baseTime.getTime())) baseTime = now;

        while (endMs <= nowMs && iter < MAX_ITER) {
          const nextState = createRandomState(baseTime, game);
          latest = nextState;

          endMs = new Date(nextState.window_end).getTime();
          if (!Number.isFinite(endMs)) endMs = 0;

          baseTime = new Date(nextState.window_end);
          if (Number.isNaN(baseTime.getTime())) baseTime = now;

          iter++;
        }

        newState = latest;
        stateToUse = latest;
      } else {
        // masih dalam window → pakai existing
        stateToUse = existing;
      }
    }

    if (newState) upserts.push(newState);

    results.push({
      ...game,
      rtp_min: stateToUse.rtp_min,
      rtp_max: stateToUse.rtp_max,
      window_start: stateToUse.window_start,
      window_end: stateToUse.window_end,
      spin_mode: stateToUse.spin_mode,
      spin_count: stateToUse.spin_count,
      speed: stateToUse.speed,
      mark1: stateToUse.mark1,
      mark2: stateToUse.mark2,
      mark3: stateToUse.mark3,
      dc_on: stateToUse.dc_on,
      buy_spin_recommend: stateToUse.buy_spin_recommend,

      // ✅ generate “live win” deterministik per window
      win_simulations: generateWinSimulations(game, stateToUse),
    });
  }

  // 3) batch upsert sekali (lebih cepat & stabil)
  if (upserts.length > 0) {
    const { error } = await supabaseAdmin.from("game_rtp_state").upsert(upserts, {
      onConflict: "game_id",
      ignoreDuplicates: false,
    });

    if (error) {
      console.error("Failed to upsert game_rtp_state", error);
    }
  }

  return results;
}
