/**
 * Club colours, for the shirts on the pitch view.
 *
 * FPL's bootstrap payload carries no team colours — it serves real kit images
 * from its own CDN, which this app cannot use. Recognising your own squad at a
 * glance is most of what makes a pitch view readable, so the colours are held
 * here instead, keyed by the short name FPL uses.
 *
 * Promoted clubs change every season, so an unknown key must never break the
 * render: the fallback is a neutral shirt with the club's initials, which still
 * identifies the player.
 */

export interface Kit {
  /** Shirt body. */
  primary: string;
  /** Sleeves and trim. Equal to primary for a plain shirt. */
  accent: string;
  /** Text drawn on the shirt, chosen for contrast against primary. */
  ink: string;
}

const FALLBACK: Kit = { primary: "#4d2157", accent: "#6b3277", ink: "#ffffff" };

const KITS: Record<string, Kit> = {
  ARS: { primary: "#ef0107", accent: "#ffffff", ink: "#ffffff" },
  AVL: { primary: "#670e36", accent: "#95bfe5", ink: "#ffffff" },
  BOU: { primary: "#da291c", accent: "#000000", ink: "#ffffff" },
  BRE: { primary: "#e30613", accent: "#ffffff", ink: "#ffffff" },
  BHA: { primary: "#0057b8", accent: "#ffcd00", ink: "#ffffff" },
  BUR: { primary: "#6c1d45", accent: "#99d6ea", ink: "#ffffff" },
  CHE: { primary: "#034694", accent: "#ffffff", ink: "#ffffff" },
  COV: { primary: "#78d0f3", accent: "#ffffff", ink: "#0b2b3a" },
  CRY: { primary: "#1b458f", accent: "#c4122e", ink: "#ffffff" },
  EVE: { primary: "#003399", accent: "#ffffff", ink: "#ffffff" },
  FUL: { primary: "#ffffff", accent: "#000000", ink: "#111111" },
  HUL: { primary: "#f5a12d", accent: "#000000", ink: "#2b1a00" },
  IPS: { primary: "#0044a9", accent: "#ffffff", ink: "#ffffff" },
  LEE: { primary: "#ffffff", accent: "#1d428a", ink: "#1d428a" },
  LEI: { primary: "#003090", accent: "#fdbe11", ink: "#ffffff" },
  LIV: { primary: "#c8102e", accent: "#00b2a9", ink: "#ffffff" },
  MCI: { primary: "#6cabdd", accent: "#ffffff", ink: "#06263f" },
  MUN: { primary: "#da291c", accent: "#000000", ink: "#ffffff" },
  NEW: { primary: "#241f20", accent: "#ffffff", ink: "#ffffff" },
  NFO: { primary: "#dd0000", accent: "#ffffff", ink: "#ffffff" },
  SHU: { primary: "#ee2737", accent: "#000000", ink: "#ffffff" },
  SOU: { primary: "#d71920", accent: "#ffffff", ink: "#ffffff" },
  SUN: { primary: "#eb172b", accent: "#ffffff", ink: "#ffffff" },
  TOT: { primary: "#ffffff", accent: "#132257", ink: "#132257" },
  WHU: { primary: "#7a263a", accent: "#1bb1e7", ink: "#ffffff" },
  WOL: { primary: "#fdb913", accent: "#231f20", ink: "#231f20" },
};

export function kitFor(shortName: string): Kit {
  return KITS[shortName.toUpperCase()] ?? FALLBACK;
}
