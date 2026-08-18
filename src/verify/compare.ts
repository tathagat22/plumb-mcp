/**
 * `compareOne` — every typed check the engine runs against a single node.
 *
 * Splitting this into one function per delta kind would read better in
 * isolation and much worse in practice: the checks all share the node, the
 * resolved token table, the tolerance config, and a `pushPx` helper closed
 * over all three. Read top to bottom, it is the complete answer to "what does
 * Plumb know how to notice about one element" — which is exactly the list you
 * want in front of you when adding the next check.
 */

import { resolveLayout } from "../normalize/resolve";
import type { PdsNode, TokenTable } from "../pds";
import { isUserAgentColor, pushColorDelta } from "./color";
import {
  computeLineHeightRatio,
  normalizeWeight,
  parseBlurRadius,
  parsePx,
  parseRotation,
  parseShadowBlur,
  parseTextToken,
  round,
} from "./parse";
import { isPlaceholderText } from "./text";
import type { Delta, RenderedElement, Severity, Tolerances } from "./types";

/* ---------------------------------------------------------------------- */
/* compareOne — every typed check                                          */
/* ---------------------------------------------------------------------- */

/** Per-run context shared across every {@link compareOne} call. */
export interface CompareContext {
  /** Trimmed `chars` strings the design repeats ≥3× — treated as template filler. */
  dupChars: Set<string>;
}

export function compareOne(
  node: PdsNode,
  r: RenderedElement,
  tokens: TokenTable,
  tol: Tolerances,
  deltas: Delta[],
  ctx: CompareContext,
): void {
  const styles = r.styles ?? {};

  // Numeric diff helper — uses tol.px by default; pass overrides for text.size etc.
  const pushPx = (
    kind: string,
    expected: number,
    actual: number,
    custom?: { ok: number; warn: number },
  ): void => {
    const diff = Math.abs(expected - actual);
    const t = custom ?? tol.px;
    if (diff <= t.ok) return;
    const severity: Severity = diff > t.warn ? "error" : "warn";
    deltas.push({ el: node.el, name: node.name, kind, expected, actual, diff, severity });
  };

  // --- Size ----------------------------------------------------------------
  // Skip axes the compiler can only ESTIMATE: fill/hug auto-layout children and
  // text with content-driven auto-resize get their real size from Figma's layout
  // engine, so a delta vs the authored estimate is noise, not a defect.
  const wEstimate =
    node.sizing?.w === "fill" ||
    node.sizing?.w === "hug" ||
    (node.type === "text" && node.textGrow === "wh");
  const hEstimate =
    node.sizing?.h === "fill" ||
    node.sizing?.h === "hug" ||
    (node.type === "text" && (node.textGrow === "h" || node.textGrow === "wh"));
  if (node.box.w > 0 && r.box.w > 0 && !wEstimate) pushPx("size.w", node.box.w, r.box.w);
  if (node.box.h > 0 && r.box.h > 0 && !hEstimate) pushPx("size.h", node.box.h, r.box.h);

  // --- Layout (only if PDS describes one) ---------------------------------
  // Layout may arrive as a `$lN` ref into tokens.layout (v0.10+) — resolve
  // once and use the literal everywhere below.
  const layout = resolveLayout(node.layout, tokens);
  if (layout) {
    const pdsFlow = layout.flow === "col" ? "column" : "row";
    const renFlow = styles.flexDirection;
    if (renFlow && renFlow !== pdsFlow) {
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "layout.flow",
        expected: pdsFlow,
        actual: renFlow,
        severity: "error",
      });
    }
    if (layout.gap !== undefined) {
      const v = parsePx(styles.gap);
      if (v !== null) pushPx("layout.gap", layout.gap, v);
    }
    const pad = layout.pad;
    const sideMap: Array<[string, number, number | null]> = [
      ["pad.top", pad[0], parsePx(styles.paddingTop)],
      ["pad.right", pad[1], parsePx(styles.paddingRight)],
      ["pad.bottom", pad[2], parsePx(styles.paddingBottom)],
      ["pad.left", pad[3], parsePx(styles.paddingLeft)],
    ];
    for (const [kind, expected, actual] of sideMap) {
      if (actual !== null) pushPx(kind, expected, actual);
    }
    if (layout.justify) {
      const v = styles.justifyContent;
      if (v && v !== layout.justify) {
        deltas.push({
          el: node.el,
          name: node.name,
          kind: "layout.justify",
          expected: layout.justify,
          actual: v,
          severity: "warn",
        });
      }
    }
    if (layout.align) {
      const v = styles.alignItems;
      if (v && v !== layout.align) {
        deltas.push({
          el: node.el,
          name: node.name,
          kind: "layout.align",
          expected: layout.align,
          actual: v,
          severity: "warn",
        });
      }
    }
  }

  // --- Fill (background-color for non-text; text colour goes below) -------
  if (
    node.fill &&
    node.fill.startsWith("$c") &&
    node.type !== "text" &&
    styles.backgroundColor
  ) {
    pushColorDelta(
      node,
      "fill",
      tokens.color[node.fill],
      styles.backgroundColor,
      tol,
      deltas,
    );
  }

  // --- Form-control UA-style fallthrough (real-world bug #16) -------------
  // When rendered.backgroundColor parses to a UA keyword like `buttonface` or
  // `field`, the agent's reset CSS isn't taking and the browser is painting
  // the native control. This silently breaks dashboards built on <button>
  // elements with custom backgrounds. Surface it as a warn.
  if (styles.backgroundColor && isUserAgentColor(styles.backgroundColor)) {
    deltas.push({
      el: node.el,
      name: node.name,
      kind: "ua-style-fallthrough",
      expected: "explicit background-color",
      actual: styles.backgroundColor,
      severity: "warn",
    });
  }

  // --- Text content ------------------------------------------------------
  // Content vs. fidelity: a wrong *colour* or *icon* is always a bug, but a
  // wrong *string* often isn't — the agent is supposed to drop real content
  // into the design's placeholder slots. So a mismatch on filler text (lorem,
  // generic labels, numeric stubs, repeated copy-paste cells, long body copy)
  // is surfaced as advisory `info` (visible, but it doesn't dent the fit score
  // or the fix list). A mismatch on a meaningful UI label still warns.
  if (typeof node.chars === "string" && typeof r.text === "string") {
    const exp = node.chars.trim();
    const act = r.text.trim();
    if (exp !== act) {
      const placeholder = isPlaceholderText(exp, ctx.dupChars.has(exp));
      deltas.push({
        el: node.el,
        name: node.name,
        kind: placeholder ? "text.placeholder" : "text.chars",
        expected: exp,
        actual: act,
        severity: placeholder ? "info" : "warn",
      });
    }
  }

  // --- Text colour (TEXT nodes use `color` in the browser) ---------------
  if (node.type === "text" && node.fill && node.fill.startsWith("$c") && styles.color) {
    pushColorDelta(node, "text.color", tokens.color[node.fill], styles.color, tol, deltas);
  }

  // --- Text decoration (real-world bug #14: missing strike-through on
  //     completed-checklist items) ----------------------------------------
  if (node.type === "text" && node.textDecoration) {
    const dec = (styles.textDecorationLine ?? styles.textDecoration ?? "").toLowerCase();
    if (!dec.includes(node.textDecoration)) {
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "text.decoration",
        expected: node.textDecoration,
        actual: dec || "none",
        severity: "error",
      });
    }
  }

  // --- Text style (font weight / size / line-height / family) ------------
  if (node.text && node.text.startsWith("$t")) {
    const tk = tokens.text[node.text];
    const parsed = tk ? parseTextToken(tk) : null;
    if (parsed) {
      const renSize = parsePx(styles.fontSize);
      if (renSize !== null) pushPx("text.size", parsed.size, renSize, { ok: 0.5, warn: 1.5 });
      const renWeight = normalizeWeight(styles.fontWeight);
      if (renWeight !== null && renWeight !== parsed.weight) {
        const diff = Math.abs(renWeight - parsed.weight);
        deltas.push({
          el: node.el,
          name: node.name,
          kind: "text.weight",
          expected: parsed.weight,
          actual: renWeight,
          diff,
          severity: diff <= 100 ? "warn" : "error",
        });
      }
      if (parsed.lh) {
        const renRatio = computeLineHeightRatio(styles.lineHeight, renSize);
        if (renRatio !== null) {
          const diff = Math.abs(renRatio - parsed.lh);
          if (diff > 0.05) {
            deltas.push({
              el: node.el,
              name: node.name,
              kind: "text.lh",
              expected: parsed.lh,
              actual: Math.round(renRatio * 100) / 100,
              diff,
              severity: diff > 0.15 ? "error" : "warn",
            });
          }
        }
      }
      if (parsed.family && styles.fontFamily) {
        const ff = styles.fontFamily.toLowerCase();
        if (!ff.includes(parsed.family.toLowerCase())) {
          deltas.push({
            el: node.el,
            name: node.name,
            kind: "text.family",
            expected: parsed.family,
            actual: styles.fontFamily,
            severity: "warn",
          });
        }
      }
    }
  }

  // --- Border radius -----------------------------------------------------
  if (node.radius !== undefined && styles.borderRadius) {
    let expected: number | "full" | null = null;
    if (typeof node.radius === "string") expected = tokens.radius[node.radius] ?? null;
    else if (Array.isArray(node.radius)) expected = node.radius[0] ?? null;
    if (expected !== null) {
      const v = parsePx(styles.borderRadius);
      if (v !== null) {
        if (expected === "full") {
          const minSide = Math.min(node.box.w, node.box.h);
          // Anything >= half the smaller side is visually a pill/circle.
          if (minSide > 0 && v + tol.px.ok < minSide / 2) {
            deltas.push({
              el: node.el,
              name: node.name,
              kind: "radius",
              expected: `full (>= ${Math.round((minSide / 2) * 100) / 100}px)`,
              actual: v,
              severity: v + tol.px.warn < minSide / 2 ? "error" : "warn",
            });
          }
        } else {
          pushPx("radius", expected, v);
        }
      }
    }
  }

  // --- Stroke (border) ---------------------------------------------------
  if (node.stroke && node.stroke.startsWith("$c") && styles.borderColor) {
    pushColorDelta(node, "stroke", tokens.color[node.stroke], styles.borderColor, tol, deltas);
  }
  if (node.strokeW !== undefined && styles.borderWidth) {
    const v = parsePx(styles.borderWidth);
    if (v !== null) pushPx("stroke.width", node.strokeW, v);
  }

  // --- Opacity -----------------------------------------------------------
  if (typeof node.opacity === "number" && styles.opacity) {
    const v = parseFloat(styles.opacity);
    if (!Number.isNaN(v)) {
      const diff = Math.abs(node.opacity - v);
      if (diff > 0.05) {
        deltas.push({
          el: node.el,
          name: node.name,
          kind: "opacity",
          expected: node.opacity,
          actual: v,
          diff,
          severity: diff > 0.15 ? "error" : "warn",
        });
      }
    }
  }

  // --- v0.10 Phase 6 — shadow / rotation / flex-child / fill-stack -------

  // Shadow: compare resolved CSS string or just confirm the renderer set
  // a non-empty box-shadow. We deliberately don't byte-compare — small
  // colour/blur rounding shouldn't flag — but missing it entirely is a real bug.
  const expectedShadow =
    typeof node.shadow === "string" && node.shadow.startsWith("$s")
      ? tokens.shadow[node.shadow]
      : node.shadow;
  if (expectedShadow && (!styles.boxShadow || styles.boxShadow === "none")) {
    deltas.push({
      el: node.el,
      name: node.name,
      kind: "shadow.missing",
      expected: expectedShadow,
      actual: styles.boxShadow ?? "(unset)",
      severity: "error",
    });
  } else if (expectedShadow && styles.boxShadow) {
    // Shadow present but visibly off — a 2px blur where the design has a 24px
    // soft drop is the kind of "tiny detail" that quietly cheapens a build.
    const expBlur = parseShadowBlur(expectedShadow);
    const renBlur = parseShadowBlur(styles.boxShadow);
    if (expBlur !== null && renBlur !== null) {
      const diff = Math.abs(expBlur - renBlur);
      if (diff > tol.px.warn) {
        deltas.push({
          el: node.el,
          name: node.name,
          kind: "shadow.blur",
          expected: expBlur,
          actual: renBlur,
          diff,
          severity: "warn",
        });
      }
    }
  }

  // Backdrop filter (glassmorphism / frosted surfaces). PDS carries a CSS-ready
  // `backdrop-filter` string; agents routinely drop it, leaving a flat opaque
  // panel where the design had a translucent blurred one. A missing backdrop is
  // an error; a present-but-different blur radius is a warn.
  if (node.backdropFilter) {
    const ren = (styles.backdropFilter ?? "").trim();
    if (!ren || ren.toLowerCase() === "none") {
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "backdrop.missing",
        expected: node.backdropFilter,
        actual: ren || "(unset)",
        severity: "error",
      });
    } else {
      const expBlur = parseBlurRadius(node.backdropFilter);
      const renBlur = parseBlurRadius(ren);
      if (expBlur !== null && renBlur !== null) {
        const diff = Math.abs(expBlur - renBlur);
        if (diff > tol.px.warn) {
          deltas.push({
            el: node.el,
            name: node.name,
            kind: "backdrop.blur",
            expected: expBlur,
            actual: renBlur,
            diff,
            severity: "warn",
          });
        }
      }
    }
  }

  // Rotation: parse `transform: rotate(Ndeg)` or a 2D matrix. Allow ±0.5°
  // slack so subpixel rounding doesn't fire.
  if (typeof node.rotation === "number" && Math.abs(node.rotation) > 0.5) {
    const renderedDeg = parseRotation(styles.transform);
    if (renderedDeg !== null) {
      const diff = Math.abs(node.rotation - renderedDeg);
      if (diff > 1) {
        deltas.push({
          el: node.el,
          name: node.name,
          kind: "rotation",
          expected: round(node.rotation, 2),
          actual: round(renderedDeg, 2),
          diff,
          severity: diff > 5 ? "error" : "warn",
        });
      }
    }
  }

  // Flex-child sizing — grow + align-self. Misses here are the #1
  // "almost right" layout bug from real screens.
  if (typeof node.grow === "number" && node.grow > 0 && styles.flexGrow) {
    const v = parseFloat(styles.flexGrow);
    if (!Number.isNaN(v) && Math.abs(v - node.grow) > 0.01) {
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "flex.grow",
        expected: node.grow,
        actual: v,
        diff: Math.abs(v - node.grow),
        severity: "warn",
      });
    }
  }
  if (node.selfAlign && styles.alignSelf && styles.alignSelf !== "auto") {
    const cssAlign =
      node.selfAlign === "stretch"
        ? "stretch"
        : node.selfAlign === "min"
          ? "flex-start"
          : node.selfAlign === "max"
            ? "flex-end"
            : node.selfAlign === "center"
              ? "center"
              : undefined;
    if (cssAlign && cssAlign !== styles.alignSelf) {
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "flex.selfAlign",
        expected: cssAlign,
        actual: styles.alignSelf,
        severity: "warn",
      });
    }
  }

  // Fill-stack count — when PDS says "this surface has 3 layered fills"
  // a flat `background-color` rendered alone is a clear miss. Resolve the
  // fills ref (may be a $fN token) before counting.
  const fillsValue =
    typeof node.fills === "string"
      ? (tokens as TokenTable).fills?.[node.fills]
      : node.fills;
  if (Array.isArray(fillsValue) && fillsValue.length > 1) {
    const bg = styles.backgroundImage ?? "";
    // Count comma-separated layers in background-image. A single solid
    // colour shows up as just `background-color` with no `background-image`.
    const layers = bg && bg !== "none" ? bg.split(/,\s*(?![^()]*\))/).length : 0;
    if (layers < fillsValue.length) {
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "fills.count",
        expected: fillsValue.length,
        actual: layers,
        diff: fillsValue.length - layers,
        severity: "warn",
      });
    }
  }

  // --- Asset fidelity (real-world: a logo/icon/image must be the actual
  //     exported asset or vector — NOT a redrawn box). Structural checks can't
  //     see that a logo is the *wrong picture*, but they can catch the cases
  //     that quietly inflate the score: the asset wasn't used at all (redrawn
  //     as a styled div) or a different asset id was swapped in. Only fires on
  //     elements the agent actually tagged. ---
  const isRaster = typeof node.assetId === "string" && node.assetId.length > 0;
  const isVectorAsset =
    node.type === "vector" || node.type === "image" || node.vectorPath !== undefined;
  if (isRaster || isVectorAsset) {
    const rAsset = r.asset;
    if (isRaster && rAsset && rAsset !== node.assetId) {
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "asset.mismatch",
        expected: node.assetId ?? null,
        actual: rAsset,
        severity: "error",
      });
    } else if (isRaster && rAsset === node.assetId) {
      // exact exported asset used — perfect, no delta.
    } else if (!r.img) {
      // a visual node rendered with no real image/vector content → redrawn or omitted.
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "asset.missing",
        expected: isRaster ? (node.assetId ?? "exported asset") : "image/vector content",
        actual: "(none — redrawn or omitted)",
        severity: "error",
      });
    } else if (isRaster && !rAsset) {
      // rendered an image but didn't tag which — can't confirm it's the export.
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "asset.untagged",
        expected: node.assetId ?? null,
        actual: "(image present, data-plumb-asset missing)",
        severity: "warn",
      });
    }
  }
}
