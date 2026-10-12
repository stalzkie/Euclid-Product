import { describe, expect, it } from "vitest";
import {
  contrast,
  darkenToContrast,
  hslToRgb,
  luminance,
  matchDesign,
  parseColor,
  radiusBand,
  readBackground,
  readDeclarations,
  readRadius,
  chroma,
  saturation,
  toHex,
} from "@/lib/design-match";

/**
 * The designer proposes a palette read off the founder's own site. The risk is
 * not that it looks a little off — they can see it and override it — but that
 * it proposes something unreadable, or mistakes the page's text colour for the
 * brand. Those are what these cover.
 */

describe("parseColor", () => {
  it("reads the hex forms", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor("#0A72DC")).toEqual({ r: 10, g: 114, b: 220 });
    expect(parseColor("#0a72dcff")).toEqual({ r: 10, g: 114, b: 220 });
    expect(parseColor("#f00c")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("reads rgb in both the comma and the space form", () => {
    expect(parseColor("rgb(10, 114, 220)")).toEqual({ r: 10, g: 114, b: 220 });
    expect(parseColor("rgb(10 114 220)")).toEqual({ r: 10, g: 114, b: 220 });
    expect(parseColor("rgba(10, 114, 220, 0.5)")).toEqual({ r: 10, g: 114, b: 220 });
    expect(parseColor("rgb(10 114 220 / 50%)")).toEqual({ r: 10, g: 114, b: 220 });
  });

  it("reads percentage channels", () => {
    expect(parseColor("rgb(100%, 0%, 0%)")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("reads hsl", () => {
    expect(parseColor("hsl(0, 100%, 50%)")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor("hsl(210 100% 50%)")).toEqual({ r: 0, g: 128, b: 255 });
    expect(parseColor("hsl(0 0% 100%)")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("reads the handful of named colours a stylesheet actually uses", () => {
    expect(parseColor("white")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor(" BLACK ")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("returns null rather than guessing at anything else", () => {
    expect(parseColor("")).toBeNull();
    expect(parseColor("currentColor")).toBeNull();
    expect(parseColor("var(--brand)")).toBeNull();
    expect(parseColor("#12345")).toBeNull();
    expect(parseColor("#gggggg")).toBeNull();
    expect(parseColor("rgb(10, 114)")).toBeNull();
    expect(parseColor("linear-gradient(#fff, #000)")).toBeNull();
  });
});

describe("hslToRgb", () => {
  it("walks the hue wheel", () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual({ r: 255, g: 0, b: 0 });
    expect(hslToRgb(120, 1, 0.5)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hslToRgb(240, 1, 0.5)).toEqual({ r: 0, g: 0, b: 255 });
    expect(hslToRgb(360, 1, 0.5)).toEqual({ r: 255, g: 0, b: 0 });
  });
});

describe("contrast", () => {
  it("puts black on white at the top of the scale", () => {
    expect(contrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 1);
  });

  it("is the same either way round", () => {
    const a = { r: 10, g: 114, b: 220 };
    const b = { r: 255, g: 255, b: 255 };
    expect(contrast(a, b)).toBeCloseTo(contrast(b, a), 10);
  });

  it("puts a colour against itself at 1", () => {
    expect(contrast({ r: 80, g: 80, b: 80 }, { r: 80, g: 80, b: 80 })).toBeCloseTo(1, 10);
  });

  it("rises with luminance", () => {
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 3);
    expect(luminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 3);
  });
});

describe("saturation", () => {
  it("is zero for every grey", () => {
    expect(saturation({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(saturation({ r: 128, g: 128, b: 128 })).toBe(0);
    expect(saturation({ r: 255, g: 255, b: 255 })).toBe(0);
  });

  it("is one for a pure hue", () => {
    expect(saturation({ r: 255, g: 0, b: 0 })).toBe(1);
  });
});

describe("chroma", () => {
  it("is zero for a grey and wide for a hue", () => {
    expect(chroma({ r: 40, g: 40, b: 40 })).toBe(0);
    expect(chroma({ r: 255, g: 0, b: 0 })).toBe(255);
  });

  it("is small for a near-black that saturation calls colourful", () => {
    const nearBlack = { r: 25, g: 29, b: 32 }; // #191D20
    expect(saturation(nearBlack)).toBeGreaterThan(0.18);
    expect(chroma(nearBlack)).toBeLessThan(24);
  });
});

describe("darkenToContrast", () => {
  const white = { r: 255, g: 255, b: 255 };

  it("darkens a pale brand colour until white text on it is readable", () => {
    const pale = { r: 255, g: 214, b: 10 }; // a yellow; white on it is unreadable
    expect(contrast(pale, white)).toBeLessThan(3.4);
    const fixed = darkenToContrast(pale);
    expect(contrast(fixed, white)).toBeGreaterThanOrEqual(3.4);
  });

  it("leaves a colour that already passes alone", () => {
    const blue = { r: 10, g: 114, b: 220 };
    expect(darkenToContrast(blue)).toEqual(blue);
  });

  it("terminates on white, the worst case there is", () => {
    const fixed = darkenToContrast(white);
    expect(contrast(fixed, white)).toBeGreaterThanOrEqual(3.4);
  });
});

describe("readDeclarations", () => {
  it("weights a named brand variable above an incidental colour", () => {
    const css = ":root{--brand:#0A72DC}.rule{border-color:#0A72DC}";
    const [brand, border] = readDeclarations(css);
    expect(brand.property).toBe("--brand");
    expect(brand.weight).toBeGreaterThan(border.weight);
  });

  it("ignores properties that are not colours", () => {
    const css = ".a{width:#0A72DC;font-family:#fff}";
    expect(readDeclarations(css)).toEqual([]);
  });

  it("takes every colour out of a shorthand", () => {
    const css = ".a{background:#FFFFFF url(x.png) no-repeat}";
    expect(readDeclarations(css).map((d) => d.value)).toEqual(["#FFFFFF"]);
  });
});

describe("readBackground", () => {
  it("reads the page background off body", () => {
    expect(readBackground("body{background:#18181B;color:#fff}")).toEqual({
      r: 24,
      g: 24,
      b: 27,
    });
  });

  it("reads it off :root and off a grouped selector", () => {
    expect(readBackground(":root{background-color:#101014}")).toEqual({ r: 16, g: 16, b: 20 });
    expect(readBackground("html, body { background: rgb(2 6 23) }")).toEqual({
      r: 2,
      g: 6,
      b: 23,
    });
  });

  it("keeps looking past a background it cannot read", () => {
    const css = "body{background:linear-gradient(red,blue)} html{background:#101014}";
    expect(readBackground(css)).toEqual({ r: 16, g: 16, b: 20 });
  });

  it("falls back to white, which is what a browser paints", () => {
    expect(readBackground(".card{background:#000}")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("does not mistake a class whose name ends in body", () => {
    expect(readBackground(".modal-body{background:#000}")).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe("readRadius", () => {
  it("takes the radius the site uses most", () => {
    const css = ".a{border-radius:4px}.b{border-radius:12px}.c{border-radius:12px}";
    expect(readRadius(css)).toBe(12);
  });

  it("converts rem to pixels", () => {
    expect(readRadius(".a{border-radius:0.5rem}")).toBe(8);
  });

  it("ignores a pill, which is a shape and not a corner radius", () => {
    expect(readRadius(".pill{border-radius:9999px}.a{border-radius:6px}")).toBe(6);
    expect(readRadius(".circle{border-radius:50%}")).toBeNull();
  });

  it("reads only the first value of a multi-corner shorthand", () => {
    expect(readRadius(".a{border-radius:6px 6px 0 0}")).toBe(6);
  });

  it("returns null when the site rounds nothing", () => {
    expect(readRadius(".a{color:#fff}")).toBeNull();
  });
});

describe("radiusBand", () => {
  it("bands the corners", () => {
    expect(radiusBand(0)).toBe("Sharp");
    expect(radiusBand(5)).toBe("Sharp");
    expect(radiusBand(6)).toBe("Soft");
    expect(radiusBand(11)).toBe("Soft");
    expect(radiusBand(12)).toBe("Round");
    expect(radiusBand(null)).toBeNull();
  });
});

describe("matchDesign", () => {
  it("proposes the brand colour, a light theme and the site's corners", () => {
    const css = `
      :root{--brand:#0A72DC;--text:#1A1A1A}
      body{background:#FFFFFF;color:#1A1A1A}
      .btn{background:#0A72DC;color:#FFFFFF;border-radius:10px}
      .card{border-radius:10px;border-color:#E7E7E4}
    `;
    const match = matchDesign(css);
    expect(match.accent).toBe("#0A72DC");
    expect(match.theme).toBe("Light");
    expect(match.radius).toBe("Soft");
    expect(match.background).toBe("#FFFFFF");
    expect(match.adjusted).toBe(false);
  });

  it("goes dark when the page is dark", () => {
    const css = "body{background:#0B0B0F}.btn{background:#7C3AED;border-radius:14px}";
    const match = matchDesign(css);
    expect(match.theme).toBe("Dark");
    expect(match.radius).toBe("Round");
  });

  it("never proposes a brand's near-black as the accent", () => {
    // A ratio-based saturation calls #191D20 colourful; it is a text colour.
    const css = `
      body{background:#FFFFFF}
      .a{background:#191D20}.b{background:#191D20}.c{background:#191D20}
      .btn{background:#27A644}
    `;
    const match = matchDesign(css);
    expect(match.candidates.map((c) => c.hex)).toEqual(["#27A644"]);
    // Darkened on the way out, which is a separate decision.
    expect(match.accent).not.toBe("#191D20");
  });

  it("never proposes a grey as the accent", () => {
    // Text and rules outnumber the brand colour on any real page.
    const css = `
      body{background:#FFFFFF}
      .a{color:#1A1A1A}.b{color:#1A1A1A}.c{color:#1A1A1A}.d{color:#737379}
      .e{border-color:#E7E7E4}.f{border-color:#E7E7E4}
      .btn{background:#D1347A}
    `;
    expect(matchDesign(css).accent).toBe("#D1347A");
  });

  it("will not propose an accent that white text disappears on", () => {
    // Amber: bright enough that white text on it fails, dark enough that it
    // is not filtered out as invisible against the page.
    const css = "body{background:#FFF}.btn{background:#F59E0B}.b{background:#F59E0B}";
    const match = matchDesign(css);
    expect(match.adjusted).toBe(true);
    expect(contrast(parseColor(match.accent)!, { r: 255, g: 255, b: 255 })).toBeGreaterThanOrEqual(
      3.4,
    );
  });

  it("skips a colour that would vanish into the page behind it", () => {
    // A bright yellow is as saturated as a colour gets, and still invisible
    // on a white page — even though it is used more than the brand colour.
    const css = `
      body{background:#FFFFFF}
      .a{background:#FFE600}.b{background:#FFE600}.c{background:#FFE600}
      .btn{background:#15803D}
    `;
    expect(matchDesign(css).accent).toBe("#15803D");
  });

  it("stays neutral when there is no brand colour to find", () => {
    const match = matchDesign("body{background:#FFFFFF;color:#1A1A1A}");
    expect(match.accent).toBe("#17171A");
    expect(match.candidates).toEqual([]);
    expect(match.notes.some((n) => n.includes("No brand colour"))).toBe(true);
  });

  it("explains every part of what it chose", () => {
    const match = matchDesign("body{background:#FFF}.btn{background:#0A72DC;border-radius:10px}");
    expect(match.notes).toHaveLength(3);
    expect(match.notes.join(" ")).toContain("#0A72DC");
    expect(match.notes.join(" ")).toContain("10px");
  });

  it("offers the runners-up, strongest first and without repeats", () => {
    const css = `
      body{background:#FFF}
      .a{background:#0A72DC}.b{background:#0A72DC}.c{background:#D1347A}
    `;
    const match = matchDesign(css);
    expect(match.candidates.map((c) => c.hex)).toEqual(["#0A72DC", "#D1347A"]);
    expect(match.candidates[0].weight).toBeGreaterThan(match.candidates[1].weight);
  });

  it("normalises the same colour written two ways into one candidate", () => {
    const css = "body{background:#FFF}.a{background:#0A72DC}.b{background:rgb(10,114,220)}";
    expect(matchDesign(css).candidates).toHaveLength(1);
  });
});

describe("toHex", () => {
  it("pads and upper-cases", () => {
    expect(toHex({ r: 10, g: 114, b: 220 })).toBe("#0A72DC");
    expect(toHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
  });

  it("clamps rather than wrapping", () => {
    expect(toHex({ r: 300, g: -20, b: 128 })).toBe("#FF0080");
  });
});
