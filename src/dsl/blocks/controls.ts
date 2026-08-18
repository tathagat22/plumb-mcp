/**
 * Buttons and form fields, desugared into plain stacks.
 *
 * A `button` block is not a Figma primitive — it is a frame with a padding
 * scale, a variant's colour roles, and a text child. Same for a `field`. Doing
 * that expansion here, as a pure Block → Stack transform, keeps it out of the
 * recursive lowerer and makes the design decisions (what "secondary" means,
 * how much padding "md" is) readable in one place instead of interleaved with
 * tree-walking.
 *
 * Deliberately free of any call back into `lowerBlock`: these produce blocks,
 * they do not lower them. The thin wrappers that hand the result to the
 * lowerer stay in blocks.ts, where the recursion lives.
 */

import type { Block, BlockBase, Brand, Button, Color, Field, Stack, Text } from "../schema";

/* ------------------------------------------------------------------------ */
/* Button (→ pattern:"button" frame)                                         */
/* ------------------------------------------------------------------------ */

const BTN_PAD: Record<NonNullable<Button["size"]>, [number, number]> = {
  sm: [8, 14],
  md: [10, 18],
  lg: [14, 24],
};
const BTN_ICON: Record<NonNullable<Button["size"]>, number> = { sm: 16, md: 18, lg: 20 };

export function buttonToStack(b: Button, brand: Brand): Stack {
  const variant = b.variant ?? "primary";
  const size = b.size ?? "md";
  const [pv, ph] = BTN_PAD[size];

  let bg: Color | undefined;
  let border: BlockBase["border"];
  let textColor: Color = "@onPrimary";
  let decoration: "underline" | undefined;

  switch (variant) {
    case "primary":
      bg = "@primary";
      textColor = "@onPrimary";
      break;
    case "secondary":
      bg = brand.colors.surface ? "@surface" : "@muted";
      textColor = "@text";
      break;
    case "outline":
      border = { color: "@primary", width: 1 };
      textColor = "@primary";
      break;
    case "ghost":
      textColor = "@primary";
      break;
    case "link":
      textColor = "@primary";
      decoration = "underline";
      break;
  }

  const children: Block[] = [];
  const icon: Block | undefined = b.icon
    ? { type: "icon", name: b.icon, size: BTN_ICON[size], color: textColor }
    : undefined;
  const labelSize = size === "lg" ? 17 : size === "sm" ? 14 : 15;
  const label: Text = {
    type: "text",
    text: b.label,
    style: { size: labelSize, weight: 600, font: "body", ...(decoration ? { decoration } : {}) },
    color: textColor,
  };
  if (icon && b.iconPos !== "right") children.push(icon);
  children.push(label);
  if (icon && b.iconPos === "right") children.push(icon);

  const link = variant === "link";
  const radius = b.radius ?? (brand.radius?.md !== undefined ? "md" : 8);

  return {
    type: "stack",
    id: b.id,
    name: b.name ?? b.label,
    dir: "row",
    gap: 8,
    align: "center",
    justify: "center",
    pad: link ? 0 : [pv, ph],
    ...(bg ? { bg } : {}),
    ...(border ? { border } : {}),
    ...(link ? {} : { radius }),
    ...(b.shadow ? { shadow: b.shadow } : {}),
    ...(b.w ? { w: b.w } : {}),
    ...(b.grow ? { grow: b.grow } : {}),
    ...(b.self ? { self: b.self } : {}),
    ...(b.pos ? { pos: b.pos } : {}),
    ...(b.interactions ? { interactions: b.interactions } : {}),
    children,
  };
}

/* ------------------------------------------------------------------------ */
/* Field (→ labelled input Stack)                                            */
/* ------------------------------------------------------------------------ */

export function fieldToStack(f: Field): Stack {
  const kind = f.kind ?? "text";
  const inputChildren: Block[] = [];
  if (f.placeholder) {
    inputChildren.push({
      type: "text",
      text: f.placeholder,
      style: { size: 15, weight: 400, font: "body" },
      color: "@muted",
    });
  }
  const input: Stack = {
    type: "stack",
    name: `${kind} input`,
    dir: "row",
    align: "center",
    pad: kind === "textarea" ? [12, 14, 40, 14] : [10, 14],
    w: "fill",
    bg: "@bg",
    border: { color: "@border", width: 1 },
    radius: 8,
    children: inputChildren,
  };

  const children: Block[] = [];
  if (f.label) {
    children.push({
      type: "text",
      text: f.label,
      style: { size: 14, weight: 500, font: "body" },
      color: "@text",
    });
  }
  children.push(input);

  return {
    type: "stack",
    id: f.id,
    name: f.name ?? f.label ?? "field",
    dir: "col",
    gap: 6,
    w: f.w ?? "fill",
    children,
  };
}
