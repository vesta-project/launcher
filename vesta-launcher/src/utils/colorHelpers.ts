import chroma from "chroma-js";

export function generatePalette(baseHexOrHsl: string | { h: number, s: number, l: number }) {
  let base: chroma.Color;
  if (typeof baseHexOrHsl === 'string') {
    base = chroma(baseHexOrHsl);
  } else {
    base = chroma(baseHexOrHsl.h, baseHexOrHsl.s / 100, baseHexOrHsl.l / 100, "hsl");
  }

  const hex = base.hex();
  const contrastWithWhite = chroma.contrast(base, "white");
  const textOnPrimary = contrastWithWhite >= 4.5 ? "white" : "black";

  return {
    base: hex,
    hover: base.brighten(0.4).hex(),
    active: base.darken(0.4).hex(),
    transparent: base.alpha(0.15).css(),
    low: base.alpha(0.15).css(),
    textOnPrimary,
  };
}
