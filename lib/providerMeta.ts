import type { ProviderCode } from "./spinConfig";

export type ProviderMeta = {
  code: ProviderCode;
  label: string;
  logoSrc: string;
};

export const PROVIDER_META: ProviderMeta[] = [
  {
    code: "PP",
    label: "Pragmatic Play",
    logoSrc: "/providers/pragmatic-play.webp"
  },
  {
    code: "MICROGAMING",
    label: "Microgaming",
    logoSrc: "/providers/microgaming.webp"
  },
  {
    code: "PG",
    label: "PG Slots",
    logoSrc: "/providers/pg-slots.webp"
  },
  {
    code: "JILI",
    label: "JILI",
    logoSrc: "/providers/jili.webp"
  },
  {
    code: "SLOT88",
    label: "Slot88",
    logoSrc: "/providers/slot88.webp"
  },
  {
    code: "SPADEGAMING",
    label: "Spadegaming",
    logoSrc: "/providers/spadegaming.webp"
  }
];
