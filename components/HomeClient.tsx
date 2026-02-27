"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameWithState } from "../lib/rtpService";
import { PROVIDER_CONFIG, type SpeedMode } from "../lib/spinConfig";
import { PROVIDER_META, type ProviderMeta } from "../lib/providerMeta";

const BRAND_NAME = "SUHUCUAN"; // ganti kalau mau pakai nama lain
const PAGE_SIZE = 100;
const PLAY_LOGIN_URL = "https://sniplink.org/suhucuan-alternatif";

const getImagePathForGame = (provider: string, slug: string) => {
  const p = provider.toLowerCase();

  if (p === "pp") return `/games/pp/${slug}.jpg`;
  if (p === "pg") return `/games/pg/${slug}.jpg`;
  if (p === "jili") return `/games/jili/${slug}.jpg`;
  if (p === "microgaming") return `/games/microgaming/${slug}.jpg`;
  if (p === "spadegaming") return `/games/spadegaming/${slug}.jpg`;
  if (p === "slot88") return `/games/slot88/${slug}.jpg`;

  // fallback kalau ada provider lain
  return `/games/${slug}.jpg`;
};

// ======================
// Live Search helpers
// ======================
function normalizeForSearch(input: string) {
  // case-insensitive, tolerant (buat user "gaptek")
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // buang diakritik
    .replace(/\s+/g, " ")
    .trim();
}

// ======================
// Formatter tanggal & jam Asia/Jakarta
// ======================
const jakartaDateFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "numeric",
  month: "long",
  year: "numeric"
});

const jakartaTimeFormatterFull = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

const jakartaTimeFormatterHM = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function formatTimeHM(iso: string) {
  const d = new Date(iso);
  const parts = jakartaTimeFormatterHM.formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}.${minute}`;
}

// ======================
// Helper pola mark1–3
// ======================
function marksToEmojis(
  mark1: boolean | null,
  mark2: boolean | null,
  mark3: boolean | null
) {
  const yes = "✅";
  const no = "❌";
  const empty = "⬜";

  const show = (v: boolean | null) =>
    v === null ? empty : v ? yes : no;

  return `${show(mark1)} ${show(mark2)} ${show(mark3)}`;
}

// ======================
// RTP bar helpers
// ======================
function clampRtpPercent(value: number) {
  const rounded = Math.round(value);
  if (Number.isNaN(rounded)) return 0;
  return Math.max(0, Math.min(100, rounded));
}

function rtpBarClass(value: number) {
  const pct = clampRtpPercent(value);
  if (pct >= 85) return "bg-emerald-500"; // hijau
  if (pct >= 75) return "bg-yellow-400"; // kuning
  return "bg-red-500"; // merah
}

// ======================
// Progressive Jackpot (1–9 Miliar, gerak di ribuan/ratusan)
// ======================
const jackpotNumberFormatter = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 0
});

function hashStringToInt(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash;
}

function pseudoRandom01(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x); // 0..1
}

function computeProgressiveJackpot(game: GameWithState, now: Date): number {
  const JACKPOT_MIN = 1_000_000_000; // 1 M
  const JACKPOT_MAX = 9_000_000_000; // 9 M

  // base per game + hari → stabil, cuma digit belakang yang goyang
  const dayKey = Number(now.toISOString().slice(0, 10).replace(/-/g, "")); // YYYYMMDD
  const baseSeed = hashStringToInt(`${game.id}:${dayKey}`);

  const baseRand = pseudoRandom01(baseSeed);
  const baseRaw =
    3_000_000_000 + Math.floor(baseRand * 4_000_000_000); // 3..7.999 M
  const base = Math.floor(baseRaw / 1_000_000) * 1_000_000; // bulat ke jutaan terdekat

  // jitter cepat tiap ~200ms, tapi cuma ±50k
  const tick = Math.floor(now.getTime() / 200); // "frame" untuk animasi
  const jitterSeed = baseSeed ^ tick;
  const jitterRand = pseudoRandom01(jitterSeed); // 0..1
  const MAX_JITTER = 50_000; // maksimal ±50 ribu
  const jitter = Math.floor((jitterRand - 0.5) * 2 * MAX_JITTER); // -50k..+50k

  let value = base + jitter;

  // clamp ke 1–9 M
  if (value < JACKPOT_MIN) value = JACKPOT_MIN;
  if (value > JACKPOT_MAX) value = JACKPOT_MAX;

  // gerak di ratusan (bukan di puluhan / satuan)
  value = Math.round(value / 100) * 100;

  return value;
}

function formatJackpot(amount: number): string {
  return jackpotNumberFormatter.format(Math.floor(amount));
}

// ======================
// 3 pola cara main per game
// ======================
type SimplePattern = {
  mode: "MANUAL" | "AUTO";
  count: number;
  speed: SpeedMode | null;
  dc_on: boolean | null;
  mark1: boolean | null;
  mark2: boolean | null;
  mark3: boolean | null;
}

function pickIndex(len: number, seed: number, offset: number) {
  if (len <= 0) return 0;
  const v = (seed + offset) % len;
  return v < 0 ? v + len : v;
}

function buildPatterns(game: GameWithState): SimplePattern[] {
  const config = PROVIDER_CONFIG[game.provider];
  const baseMode = game.spin_mode;
  const autoCounts = config.autoSpinCounts;
  const manualCounts = config.manualSpinCounts;

  const defaultAuto = autoCounts[0] ?? 10;
  const defaultManual = manualCounts[0] ?? 10;
  const baseCount =
    game.spin_count ??
    (baseMode === "AUTO" ? defaultAuto : defaultManual);

  // seed deterministik per game + window
  const seedBase =
    Math.round(game.rtp_min * 100) +
    new Date(game.window_start).getHours() * 17 +
    game.display_name.length * 13;

  const pickSpeedFor = (patternIndex: number): SpeedMode | null => {
    const speeds = config.allowedSpeeds;
    if (!speeds || speeds.length === 0) return null;
    const idx = pickIndex(speeds.length, seedBase, 10 + patternIndex * 7);
    return speeds[idx];
  };

  const pickDcFor = (patternIndex: number): boolean | null => {
    if (!game.has_dc) return null;
    const v = (seedBase + patternIndex * 13) % 100;
    // 70% DC ON, 30% OFF
    return v < 70;
  };

  const pickMarksFor = (
    patternIndex: number,
    _mode: "MANUAL" | "AUTO"
  ): { mark1: boolean | null; mark2: boolean | null; mark3: boolean | null } => {
    // Provider tanpa marks
    if (!game.has_marks) {
      return { mark1: null, mark2: null, mark3: null };
    }

    // AUTO & MANUAL sama-sama random deterministik
    // mark1 & mark2 tidak boleh sama-sama ✅
    const base = seedBase + (patternIndex + 1) * 101;

    let m1 = pseudoRandom01(base) < 0.5;
    let m2 = pseudoRandom01(base + 137) < 0.5;
    let m3 = pseudoRandom01(base + 251) < 0.5;

    if (m1 && m2) {
      const fix = pseudoRandom01(base + 389);
      if (fix < 0.5) m1 = false;
      else m2 = false;
    }

    return { mark1: m1, mark2: m2, mark3: m3 };
  };

  if (baseMode === "AUTO") {
    const autoIdx2 = pickIndex(autoCounts.length, seedBase, 1);
    const manualIdx = pickIndex(manualCounts.length, seedBase, 2);

    return [
      {
        mode: "AUTO",
        count: baseCount,
        speed: pickSpeedFor(0),
        dc_on: pickDcFor(0),
        ...pickMarksFor(0, "AUTO")
      },
      {
        mode: "AUTO",
        count: autoCounts[autoIdx2] ?? defaultAuto,
        speed: pickSpeedFor(1),
        dc_on: pickDcFor(1),
        ...pickMarksFor(1, "AUTO")
      },
      {
        mode: "MANUAL",
        count: manualCounts[manualIdx] ?? defaultManual,
        speed: pickSpeedFor(2),
        dc_on: pickDcFor(2),
        ...pickMarksFor(2, "MANUAL")
      }
    ];
  } else {
    const manualIdx2 = pickIndex(manualCounts.length, seedBase, 1);
    const autoIdx = pickIndex(autoCounts.length, seedBase, 2);

    return [
      {
        mode: "MANUAL",
        count: baseCount,
        speed: pickSpeedFor(0),
        dc_on: pickDcFor(0),
        ...pickMarksFor(0, "MANUAL")
      },
      {
        mode: "MANUAL",
        count: manualCounts[manualIdx2] ?? defaultManual,
        speed: pickSpeedFor(1),
        dc_on: pickDcFor(1),
        ...pickMarksFor(1, "MANUAL")
      },
      {
        mode: "AUTO",
        count: autoCounts[autoIdx] ?? defaultAuto,
        speed: pickSpeedFor(2),
        dc_on: pickDcFor(2),
        ...pickMarksFor(2, "AUTO")
      }
    ];
  }
}

function patternLine(p: SimplePattern) {
  const modeText = p.mode === "AUTO" ? "Spin Auto" : "Spin Manual";
  const countText = `${p.count}X`;

  let speedText = "";
  if (p.speed === "FAST") speedText = " • Cepat";
  if (p.speed === "TURBO") speedText = " • Turbo";

  let dcText = "";
  if (p.dc_on !== null) {
    dcText = p.dc_on ? " • DC ON" : " • DC OFF";
  }

  return `${countText} ${modeText}${speedText}${dcText}`.trim();
}

function getBuySpinInfo(game: GameWithState | null) {
  if (!game || !game.has_buy_spin) {
    return { label: "", colorClass: "" };
  }

  if (game.buy_spin_recommend === null) {
    return { label: "NETRAL", colorClass: "text-neutral-200" };
  }

  if (game.buy_spin_recommend) {
    return { label: "YES", colorClass: "text-emerald-400" };
  }

  return { label: "NO", colorClass: "text-rose-400" };
}

// ======================
// Filter provider
// ======================
type ProviderFilterValue = "ALL" | ProviderMeta["code"];

type Props = {
  games: GameWithState[];
};

export default function HomeClient({ games }: Props) {
  // live clock
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 300);
    return () => clearInterval(id);
  }, []);

  // 🚫 Anti klik kanan + shortcut DevTools (deterrent ringan)
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // F12
      if (e.key === "F12") {
        e.preventDefault();
        e.stopPropagation();
      }

      // Ctrl+Shift+I / J / C (DevTools / console)
      if (
        e.ctrlKey &&
        e.shiftKey &&
        ["I", "J", "C"].includes(e.key.toUpperCase())
      ) {
        e.preventDefault();
        e.stopPropagation();
      }

      // Ctrl+U (View Source)
      if (e.ctrlKey && e.key.toUpperCase() === "U") {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const dateText = jakartaDateFormatter.format(now);
  const timeText = jakartaTimeFormatterFull.format(now);

  // provider yang benar-benar ada game-nya
  const providersInGames = useMemo(() => {
    const codes = new Set(games.map((g) => g.provider));
    return PROVIDER_META.filter((meta) => codes.has(meta.code));
  }, [games]);

  const [activeProvider, setActiveProvider] =
    useState<ProviderFilterValue>("ALL");

  // berapa banyak game yang ditampilkan (memanjang ke bawah)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // kalau ganti provider, reset lagi ke PAGE_SIZE pertama
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeProvider]);

  const activeProviderMeta = providersInGames.find(
    (p) => p.code === activeProvider
  );
  const headerProviderLabel =
    activeProvider === "ALL"
      ? "Semua Provider"
      : activeProviderMeta?.label ?? activeProvider;

  const filteredGames = useMemo(() => {
    if (activeProvider === "ALL") return games;
    return games.filter((g) => g.provider === activeProvider);
  }, [games, activeProvider]);

  // ======================
  // LIVE SEARCH (Pencarian Permainan)
  // - sumber data: props `games` (asal public.games)
  // - hanya tampilkan hasil game aktif (is_active = TRUE)
  // ======================
  const [searchText, setSearchText] = useState("");

  const searchTextNorm = useMemo(
    () => normalizeForSearch(searchText),
    [searchText]
  );

  const searchResults = useMemo(() => {
    const q = searchTextNorm;
    if (!q) return [];

    return (
      filteredGames
        .filter((g) => g.is_active) // sesuai request: hanya is_active = TRUE
        .map((g) => {
          const nameNorm = normalizeForSearch(g.display_name);

          const starts = nameNorm.startsWith(q);
          const includes = !starts && nameNorm.includes(q);
          const wordStarts =
            !starts &&
            !includes &&
            nameNorm.split(/\s+/).some((w) => w.startsWith(q));

          // skor biar hasil paling nyambung di atas
          const score = starts ? 4 : wordStarts ? 3 : includes ? 2 : 0;

          return {
            g,
            score,
            order: g.display_order ?? 1_000_000,
            len: nameNorm.length
          };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.order - b.order || a.len - b.len)
        .slice(0, 12)
        .map((x) => x.g)
    );
  }, [filteredGames, searchTextNorm]);

  const showSearchPanel = searchText.trim().length > 0;

  const totalGames = filteredGames.length;

  // tampilkan hanya sejumlah visibleCount dari atas
  const pagedGames = filteredGames.slice(0, visibleCount);

  const canLoadMore = visibleCount < totalGames;

  // scroll kiri/kanan untuk bar provider
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollBy = (dir: "left" | "right") => {
    const container = scrollRef.current;
    if (!container) return;
    const amount = container.clientWidth * 0.6;
    container.scrollBy({
      left: dir === "left" ? -amount : amount,
      behavior: "smooth"
    });
  };

  // ======================
  // State modal Jam & Pola + Tips
  // ======================
  const [selectedGame, setSelectedGame] = useState<GameWithState | null>(null);
  const [showJamPola, setShowJamPola] = useState(false);
  const [showTips, setShowTips] = useState(false);

  const openJamPola = (game: GameWithState) => {
    setSelectedGame(game);
    setShowJamPola(true);
    setShowTips(false);
  };

  const closeJamPola = () => {
    setShowJamPola(false);
    setShowTips(false);
    setSelectedGame(null);
  };

  // ESC: tutup modal paling atas dulu
  useEffect(() => {
    if (!showJamPola && !showTips) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (showTips) {
          setShowTips(false);
        } else if (showJamPola) {
          closeJamPola();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showJamPola, showTips]);

  // helper total member dummy (keliatan hidup tapi deterministik)
  const computeTotalMember = (game: GameWithState) => {
    const seed =
      Math.round(game.rtp_min * 100) +
      new Date(game.window_start).getHours() * 31 +
      game.display_name.length * 7;
    const base = 800 + (Math.abs(seed) % 600); // 800–1399
    return base;
  };

  const currentJackpot =
    selectedGame && showJamPola
      ? computeProgressiveJackpot(selectedGame, now)
      : 0;

  const buySpinInfo = getBuySpinInfo(selectedGame);

  return (
    <main className="min-h-screen text-white">
      <section className="relative overflow-hidden text-center text-emerald-50 pb-6 pt-8 shadow-lg">
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-fuchsia-900 via-purple-950 to-indigo-950" />
        <div className="absolute inset-0 -z-10 opacity-85 [background-image:radial-gradient(900px_circle_at_12%_35%,rgba(236,72,153,0.55),transparent_60%),radial-gradient(820px_circle_at_55%_20%,rgba(168,85,247,0.45),transparent_60%),radial-gradient(900px_circle_at_92%_85%,rgba(59,130,246,0.42),transparent_60%),radial-gradient(650px_circle_at_85%_95%,rgba(34,211,238,0.22),transparent_60%)]" />
        <div className="absolute inset-0 -z-10 opacity-30 mix-blend-screen [background-image:radial-gradient(1px_1px_at_18px_26px,rgba(255,255,255,0.28),transparent_55%),radial-gradient(1px_1px_at_74px_92px,rgba(255,255,255,0.18),transparent_55%),radial-gradient(1px_1px_at_126px_54px,rgba(255,255,255,0.14),transparent_55%),radial-gradient(1px_1px_at_168px_128px,rgba(255,255,255,0.12),transparent_55%)] [background-size:180px_180px]" />
        <div className="max-w-4xl mx-auto flex flex-col items-center gap-1">
          <div className="text-[11px] tracking-[0.35em] uppercase font-bold text-emerald-100/80">
            RTP SLOT &amp; POLA GACOR HARI INI
          </div>

          {/* Logo brand menggantikan teks AYOBET */}
          <div className="mt-2">
            <img
              src="/logo.gif"
              alt={BRAND_NAME}
              className="h-14 sm:h-16 mx-auto drop-shadow-[0_0_15px_rgba(0,0,0,0.55)]"
            />
          </div>

          <div className="mt-3 text-sm text-emerald-100/90">
            {dateText}
          </div>
          <div className="font-mono text-xl tracking-widest">
            {timeText}
          </div>
          <div className="text-sm mt-1">
            Di <span className="font-semibold">{BRAND_NAME}</span>
          </div>
          <div className="mt-3 text-xl sm:text-2xl font-semibold drop-shadow">
            {headerProviderLabel}
          </div>
        </div>
      </section>

      {/* LOGIN / DAFTAR bar */}
      <section className="max-w-4xl mx-auto -mt-3 px-4">
        <div className="grid grid-cols-2 rounded-xl overflow-hidden shadow-lg border border-black/40 text-sm font-semibold">
          <a
            href="https://sniplink.org/suhucuan-alternatif"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-neutral-800/95 hover:bg-neutral-700 py-2.5 text-center"
          >
            LOGIN
          </a>

          <a
            href="https://direct.lc.chat/17058969/"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-rose-600 hover:bg-rose-500 py-2.5 text-center"
          >
            LIVE CHAT
          </a>
        </div>
      </section>

      {/* Banner utama */}
      <section className="max-w-5xl mx-auto mt-5 px-4">
        <div className="rounded-xl overflow-hidden shadow-lg bg-black/40">
          <img
            src="/banners/main.jpg"
            alt="Promo banner"
            className="w-full h-auto object-cover"
          />
        </div>
      </section>

      {/* Bar filter provider dengan logo */}
      <section className="max-w-5xl mx-auto mt-5 px-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => scrollBy("left")}
            className="h-16 w-7 flex items-center justify-center rounded-lg bg-neutral-900/80 hover:bg-neutral-800 text-xl"
          >
            ‹
          </button>

          <div
            ref={scrollRef}
            className="flex-1 overflow-x-auto scrollbar-none"
          >
            <div className="flex gap-3 min-w-max">
              {/* Tombol ALL */}
              <button
                type="button"
                onClick={() => setActiveProvider("ALL")}
                className={`h-16 px-4 rounded-lg flex flex-col items-center justify-center text-xs font-semibold ${
                  activeProvider === "ALL"
                    ? "bg-rose-600 text-white"
                    : "bg-neutral-900/80 text-emerald-100 hover:bg-neutral-800"
                }`}
              >
                <span>Semua</span>
                <span className="text-[10px] opacity-80 mt-0.5">
                  Provider
                </span>
              </button>

              {providersInGames.map((meta) => {
                const isActive = activeProvider === meta.code;
                return (
                  <button
                    key={meta.code}
                    type="button"
                    onClick={() => setActiveProvider(meta.code)}
                    className={`h-16 w-[130px] rounded-lg flex flex-col items-center justify-center border ${
                      isActive
                        ? "border-emerald-400 bg-emerald-900/60"
                        : "border-transparent bg-neutral-900/80 hover:bg-neutral-800"
                    }`}
                  >
                    <img
                      src={meta.logoSrc}
                      alt={meta.label}
                      className="h-[32px] object-contain"
                    />
                    <span className="mt-1 text-[11px] text-emerald-50">
                      {meta.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => scrollBy("right")}
            className="h-16 w-7 flex items-center justify-center rounded-lg bg-neutral-900/80 hover:bg-neutral-800 text-xl"
          >
            ›
          </button>
        </div>
      </section>

            {/* Live search game (besar, mobile-friendly) */}
      <section className="max-w-5xl mx-auto mt-4 px-4">
        <div className="rounded-2xl bg-neutral-900/70 border border-white/10 shadow-lg shadow-black/30 p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <div className="text-[11px] sm:text-xs tracking-[0.35em] uppercase text-emerald-100/80 font-bold">
              PENCARIAN GAME
            </div>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <div className="mt-3">
            <div className="flex items-center gap-2 rounded-xl bg-neutral-950/60 border border-white/10 px-3 py-3 sm:py-3.5">
              <span className="text-neutral-300 text-lg leading-none">🔎</span>

              <input
                type="text"
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Pencarian Permainan"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="flex-1 bg-transparent outline-none text-base sm:text-lg placeholder:text-neutral-500"
              />

              {searchText.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => setSearchText("")}
                  className="h-9 w-9 sm:h-10 sm:w-10 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-200 text-lg"
                  aria-label="Hapus pencarian"
                >
                  ×
                </button>
              )}
            </div>

            {/* Panel hasil teratas (live) */}
            {showSearchPanel && (
              <div className="mt-3 rounded-xl border border-white/10 bg-neutral-950/70 backdrop-blur-md overflow-hidden">
                <div className="px-3 py-2 flex items-center justify-between text-xs text-neutral-300">
                  <span>
                    Hasil teratas
                    <span className="text-neutral-500">
                      {" "}
                      • {headerProviderLabel}
                    </span>
                  </span>
                  <span className="text-[10px] text-neutral-400">
                    {searchResults.length} game
                  </span>
                </div>

                {searchResults.length === 0 ? (
                  <div className="px-3 pb-3 text-sm text-neutral-400">
                    Tidak ada permainan ditemukan.
                  </div>
                ) : (
                  <div className="px-3 pb-3 max-h-[520px] overflow-y-auto [-webkit-overflow-scrolling:touch]">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {searchResults.map((g) => {
                        const rtpPercent = clampRtpPercent(g.rtp_min);

                        return (
                          <article
                            key={g.id}
                            className="bg-neutral-900/90 rounded-xl p-2 shadow-md shadow-black/30 flex flex-col"
                          >
                            <button
                              type="button"
                              onClick={() => openJamPola(g)}
                              className="relative"
                              aria-label={`Buka info pola ${g.display_name}`}
                            >
                              <img
                                src={getImagePathForGame(g.provider, g.slug)}
                                alt={g.display_name}
                                loading="lazy"
                                decoding="async"
                                className="w-full aspect-square object-cover rounded-lg bg-neutral-800"
                              />
                              <span className="absolute left-2 top-2 text-[10px] px-2 py-0.5 rounded-full bg-black/70">
                                {g.provider}
                              </span>
                            </button>

                            <div className="mt-2 flex-1 flex flex-col gap-1 text-[10px] sm:text-[11px]">
                              <div className="font-semibold text-xs truncate">
                                {g.display_name}
                              </div>

                              {/* RTP bar */}
                              <div className="mt-1 w-full">
                                <div className="h-4 rounded-md bg-neutral-800 overflow-hidden relative">
                                  <div
                                    className={`h-full ${rtpBarClass(g.rtp_min)} rtp-bar-fill`}
                                    style={{ width: `${rtpPercent}%` }}
                                  />
                                  <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold rtp-bar-label">
                                    {rtpPercent}%
                                  </div>
                                </div>
                              </div>

                              {/* Jam */}
                              <div className="text-neutral-300 mt-1 text-[12px] sm:text-[13px]">
                                Jam{" "}
                                <span className="font-bold">
                                  {formatTimeHM(g.window_start)} – {formatTimeHM(g.window_end)}
                                </span>
                              </div>

                              {/* INFO POLA */}
                              <button
                                type="button"
                                onClick={() => openJamPola(g)}
                                className="mt-2 w-full rounded-md bg-orange-700 hover:bg-amber-600 text-[11px] font-semibold py-1.5"
                              >
                                INFO POLA
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        </div>
      </section>

      {/* Grid game – pakai filteredGames */}
      <section className="px-2 py-6 sm:px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 lg:gap-5">
            {pagedGames.map((g) => {
              const rtpPercent = clampRtpPercent(g.rtp_min);
              const folder = g.provider.toLowerCase();

              return (
                <article
                  key={g.id}
                  className="bg-neutral-900/90 rounded-xl p-1.5 sm:p-2 shadow-md shadow-black/40 flex flex-col"
                >
                  <div className="relative">
                    <img
                      src={`/games/${folder}/${g.slug}.jpg`}
                      alt={g.display_name}
                      className="w-full aspect-square object-cover rounded-lg bg-neutral-800"
                    />
                    <span className="absolute left-2 top-2 text-[10px] px-2 py-0.5 rounded-full bg-black/70">
                      {g.provider}
                    </span>
                  </div>

                  <div className="mt-1.5 flex-1 flex flex-col gap-1 text-[10px] sm:text-[11px]">
                    <div className="font-semibold text-xs truncate">
                      {g.display_name}
                    </div>

                    {/* RTP bar */}
                    <div className="mt-1 w-full">
                      <div className="h-4 sm:h-5 rounded-md bg-neutral-800 overflow-hidden relative">
                        <div
                          className={`h-full ${rtpBarClass(
                            g.rtp_min
                          )} rtp-bar-fill`}
                          style={{ width: `${rtpPercent}%` }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center text-[10px] sm:text-[11px] font-semibold rtp-bar-label">
                          {rtpPercent}%
                        </div>
                      </div>
                    </div>

                    {/* Jam */}
                    <div className="text-neutral-300 mt-1 text-[12px] sm:text-[13px]">
                      Jam{" "}
                      <span className="font-bold">
                        {formatTimeHM(g.window_start)} –{" "}
                        {formatTimeHM(g.window_end)}
                      </span>
                    </div>

                    {/* Tombol INFO POLA */}
                    <button
                      type="button"
                      onClick={() => openJamPola(g)}
                      className="mt-2 w-full rounded-md bg-orange-700 hover:bg-amber-600 text-[11px] font-semibold py-1.5"
                    >
                      INFO POLA
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          
          {/* Load more / paginasi memanjang */}
          {canLoadMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((n) => Math.min(n + PAGE_SIZE, totalGames))
                }
                className="px-4 py-2 rounded-lg bg-neutral-800/90 hover:bg-neutral-700 text-sm font-semibold"
              >
                Tampilkan {Math.min(PAGE_SIZE, totalGames - visibleCount)} game lagi
              </button>
            </div>
          )}

          {/* Info kecil jumlah game */}
          {totalGames > 0 && (
            <div className="mt-2 text-center text-xs text-neutral-400">
              Menampilkan {pagedGames.length} dari {totalGames} game
            </div>
          )}
        </div>
      </section>

      {/* Modal JAM & POLA */}
      {selectedGame && showJamPola && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center px-3 sm:px-4 py-4 sm:py-6"
          onClick={closeJamPola}
        >
          <div
            className="relative w-full max-w-md sm:max-w-lg md:max-w-2xl rounded-2xl bg-neutral-900 text-white shadow-2xl
                       max-h-[calc(100dvh-32px)] sm:max-h-[calc(100dvh-48px)]
                       overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] [-webkit-overflow-scrolling:touch]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* top bar */}
            <div className="bg-gradient-to-r from-red-600 via-fuchsia-500 to-yellow-600 h-2" />

            <button
              type="button"
              onClick={closeJamPola}
              className="absolute right-4 top-3 text-xl text-neutral-300 hover:text-white"
            >
              ×
            </button>

            <div className="p-4 sm:p-6 md:p-7 grid md:grid-cols-[1.1fr,1.6fr] gap-4 md:gap-6">
              {/* Left: gambar + jackpot + tips button */}
              <div className="flex flex-col items-center">
                <img
                  src={getImagePathForGame(selectedGame.provider, selectedGame.slug)}
                  alt={selectedGame.display_name}
                  loading="lazy"
                  decoding="async"
                  className="w-[180px] h-[180px] sm:w-[200px] sm:h-[200px] rounded-xl object-cover bg-neutral-800 shadow-md"
                />

                {/* Progressive Jackpot */}
                <div className="mt-4 w-full flex flex-col items-center">
                  <div className="jp-border-animated">
                    <div className="jp-border-animated-inner">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] text-pink-300">IDR</span>
                        <span className="text-sm sm:text-base font-mono">
                          {formatJackpot(currentJackpot)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[9px] sm:text-[10px] tracking-[0.25em] uppercase text-pink-200">
                        Progressive Jackpot
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 w-full grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => setShowTips(true)}
                  className="w-full rounded-xl bg-orange-700 hover:bg-orange-600 text-sm font-semibold py-2 shadow-md"
                >
                  Tips &amp; Trik Bermain
                </button>

                <a
                  href={PLAY_LOGIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full rounded-xl bg-amber-500 hover:bg-amber-400 text-sm font-extrabold py-2 shadow-md text-center text-neutral-900"
                >
                  Mainkan / Login
                </a>
              </div>
              </div>

              {/* Right: jam gacor + pola */}
              <div className="flex flex-col gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs tracking-[0.6em] uppercase text-red-300">
                      JAM GACOR
                    </div>
                    <img
                      src="/logo.gif"
                      alt={BRAND_NAME}
                      className="h-5 sm:h-7 md:h-8 w-auto max-w-[140px] object-contain"
                    />
                  </div>

                  <div className="mt-1 text-lg sm:text-2xl font-semibold">
                    {formatTimeHM(selectedGame.window_start)} –{" "}
                    {formatTimeHM(selectedGame.window_end)}
                  </div>
                  <div className="mt-1 text-xs text-neutral-300">
                    Rekomendasi Jam &amp; Pola Gacor SUHUCUAN.
                  </div>
                </div>

                <div>
                  <div className="text-xs tracking-[0.2em] uppercase text-pink-200 mb-1">
                    Pola Terbaru
                  </div>
                  <div className="space-y-1.5 text-sm">
                    {buildPatterns(selectedGame).map((p, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between bg-neutral-800/80 rounded-lg px-3 py-1.5"
                      >
                        <span>{patternLine(p)}</span>
                        {selectedGame.has_marks && (
                          <span className="ml-3 text-base">
                            {marksToEmojis(p.mark1, p.mark2, p.mark3)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Rekomendasi Buy Spin */}
                {selectedGame.has_buy_spin && (
                  <div className="mt-1">
                    <div className="text-xs tracking-[0.2em] uppercase text-pink-200 mb-1">
                      Buy Spin
                    </div>
                    <div className="flex items-center justify-between bg-neutral-800/80 rounded-lg px-3 py-1.5 text-sm">
                      <span>Rekomendasi Buy Spin</span>
                      <span className={`font-semibold ${buySpinInfo.colorClass}`}>
                        {buySpinInfo.label}
                      </span>
                    </div>
                  </div>
                )}

                <div className="mt-1 text-xs text-neutral-300">
                  Total member bermain:{" "}
                  <span className="font-semibold text-emerald-400">
                    {computeTotalMember(selectedGame).toLocaleString("id-ID")}{" "}
                    online
                  </span>
                </div>
              </div>
            </div>

            {/* Live probabilitas kemenangan (simulasi) */}
            {selectedGame.win_simulations?.length > 0 && (
              <div className="mt-4 w-full">
                <div className="mx-auto w-full max-w-[560px]">
                  <div className="px-1 text-center">
                    <div className="text-[11px] tracking-[0.35em] uppercase text-pink-200/90">
                      Live Win Member SUHUCUAN
                    </div>
                  </div>

                  <div className="mt-2 overflow-hidden rounded-xl border border-neutral-700/40 bg-neutral-900/30">
                    <div className="grid grid-cols-[110px,1fr,120px] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-neutral-400">
                      <div>Member</div>
                      <div>Win</div>
                      <div className="text-right">Nominal</div>
                    </div>

                    <div className="divide-y divide-neutral-800/70">
                      {selectedGame.win_simulations.slice(0, 8).map((w, idx) => (
                        <div
                          key={idx}
                          className="grid grid-cols-[110px,1fr,120px] gap-2 px-3 py-2 text-sm"
                        >
                          <div className="text-neutral-200">{w.user}</div>
                          <div className="truncate text-rose-400">{w.label}</div>
                          <div className="text-right font-mono text-amber-300">
                            {w.amount.toLocaleString("id-ID")}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="px-5 pb-5 text-[10px] text-neutral-400 border-t border-neutral-800">
              Bocoran jam &amp; pola hanya berlaku di semua permainan SUHUCUAN.
              Jam &amp; pola tidak berlaku / tidak berfungsi di luar SUHUCUAN.
            </div>
          </div>
        </div>
      )}

      {/* Modal TIPS & DISCLAIMER (nested) */}
      {showTips && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={() => setShowTips(false)}
        >
          <div
            className="max-w-xl w-full bg-white text-neutral-900 rounded-2xl shadow-2xl relative p-6 sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowTips(false)}
              className="absolute right-4 top-3 text-xl text-neutral-500 hover:text-neutral-800"
            >
              ×
            </button>

            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">💡</span>
              <h2 className="text-xl sm:text-2xl font-semibold">
                Tips dan Trik Bermain
              </h2>
            </div>

            <hr className="border-neutral-200 mb-4" />

            <ol className="list-decimal list-inside space-y-2 text-sm leading-relaxed">
              <li>
                Utamakan bermain pada jam rekomendasi (jam gacor) yang sedang
                aktif.
              </li>
              <li>
                Pilih game dengan persentase RTP paling tinggi di daftar
                hari ini.
              </li>
              <li>
                Setelah mengikuti satu set pola, evaluasi terlebih dahulu
                sebelum melanjutkan spin atau melakukan BUY SPIN.
              </li>
              <li>
                Bila sudah profit, disarankan segera mengamankan modal dan
                menarik sebagian saldo.
              </li>
              <li>
                Jika mengalami kekalahan beruntun, istirahat sejenak lalu
                lanjut dengan nominal yang sudah disesuaikan kemampuan.
              </li>
            </ol>

            <div className="mt-4 text-xs leading-relaxed">
              <span className="font-semibold text-amber-600">
                ⚠️ PERINGATAN:
              </span>{" "}
              RTP, Jam Gacor, dan Pola bermain hanya berlaku pada semua
              permainan di SUHUCUAN. Penggunaan RTP dan Pola tidak akan
              berlaku diluar permainan SUHUCUAN.
            </div>

            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => setShowTips(false)}
                className="px-6 py-2 rounded-md bg-sky-600 hover:bg-sky-500 text-sm font-semibold text-white"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
