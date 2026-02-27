// lib/spinGenerator.ts
import {
  PROVIDER_CONFIG,
  ProviderCode,
  SpinMode,
  SpeedMode
} from "./spinConfig";

function randomBool(probTrue = 0.5) {
  return Math.random() < probTrue;
}

function randomFromArray<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export type SpinPattern = {
  spin_mode: SpinMode;
  spin_count: number | null;
  speed: SpeedMode | null;
  mark1: boolean | null;
  mark2: boolean | null;
  mark3: boolean | null;
  dc_on: boolean | null;
  buy_spin_recommend: boolean | null;
};

export type SpinGeneratorInput = {
  provider: ProviderCode;
  hasMarks: boolean;
  hasDc: boolean;
  hasBuySpin: boolean;
};

export function generateSpinPattern(input: SpinGeneratorInput): SpinPattern {
  const config = PROVIDER_CONFIG[input.provider];

  // misal: 40% manual, 60% auto
  const isManual = Math.random() < 0.4;

  let spin_mode: SpinMode = isManual ? "MANUAL" : "AUTO";
  let spin_count: number | null = null;

  if (isManual) {
    spin_count = randomFromArray(config.manualSpinCounts);
  } else {
    spin_count = randomFromArray(config.autoSpinCounts);
  }

  // speed
  let speed: SpeedMode | null = null;
  if (config.allowedSpeeds && config.allowedSpeeds.length > 0) {
    speed = randomFromArray(config.allowedSpeeds);
  }

  // marks (PP & SLOT88 dengan hasMarks = true)
  let mark1: boolean | null = null;
  let mark2: boolean | null = null;
  let mark3: boolean | null = null;

  if (input.hasMarks) {
    if (isManual) {
      // aturan kamu: spin manual = semua silang
      mark1 = false;
      mark2 = false;
      mark3 = false;
    } else {
      // auto: random dengan constraint mark1 & mark2 tidak boleh sama-sama ✅
      let m1 = randomBool();
      let m2 = randomBool();
      const m3 = randomBool();

      if (m1 && m2) {
        if (Math.random() < 0.5) m1 = false;
        else m2 = false;
      }

      mark1 = m1;
      mark2 = m2;
      mark3 = m3;
    }
  }

  // DC on/off (hanya kalau game.hasDc = true)
  let dc_on: boolean | null = null;
  if (input.hasDc) {
    dc_on = randomBool(0.7); // 70% dc on, 30% dc off
  }

  // Buy Spin (hanya kalau game.hasBuySpin = true)
  let buy_spin_recommend: boolean | null = null;
  if (input.hasBuySpin) {
    buy_spin_recommend = randomBool(0.6); // 60% "Yes"
  }

  return {
    spin_mode,
    spin_count,
    speed,
    mark1,
    mark2,
    mark3,
    dc_on,
    buy_spin_recommend
  };
}
