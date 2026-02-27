// lib/spinConfig.ts

export type ProviderCode =
  | "PP"
  | "PG"
  | "SLOT88"
  | "JILI"
  | "MICROGAMING"
  | "SPADEGAMING";

export type SpinMode = "MANUAL" | "AUTO";
export type SpeedMode = "NORMAL" | "FAST" | "TURBO";

export type SpinPatternConfig = {
  autoSpinCounts: number[];
  manualSpinCounts: number[];
  allowedSpeeds?: SpeedMode[]; // kalau undefined = provider ini ga punya pengaturan speed
};

export const PROVIDER_CONFIG: Record<ProviderCode, SpinPatternConfig> = {
  PP: {
    autoSpinCounts: [10, 20, 30, 50, 70],
    manualSpinCounts: [3, 5, 6, 7, 8, 9, 10]
  },
  SLOT88: {
    autoSpinCounts: [10, 20, 30, 50, 70],
    manualSpinCounts: [3, 5, 6, 7, 8, 9, 10]
  },
  PG: {
    autoSpinCounts: [10, 30, 50, 80],
    manualSpinCounts: [3, 5, 6, 7, 8, 9, 10],
    allowedSpeeds: ["NORMAL", "TURBO"] // Turbo on/off
  },
  JILI: {
    autoSpinCounts: [50, 100],
    manualSpinCounts: [6, 8, 10, 12, 16],
    allowedSpeeds: ["NORMAL", "FAST", "TURBO"] // normal/cepat/turbo
  },
  MICROGAMING: {
    autoSpinCounts: [10, 25, 50],
    manualSpinCounts: [3, 5, 6, 7, 8, 9, 10],
    allowedSpeeds: ["NORMAL", "FAST", "TURBO"]
  },
  SPADEGAMING: {
    autoSpinCounts: [10, 25, 50],
    manualSpinCounts: [3, 5, 6, 7, 8, 9, 10],
    allowedSpeeds: ["NORMAL", "TURBO"]
  }
};
