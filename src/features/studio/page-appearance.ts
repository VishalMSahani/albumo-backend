// Shared page geometry. Keep the copies in Studio, storefront, Admin and API identical.
export type PageAppearance = {
  margin?: number | undefined;
  font?: "sans" | "serif" | "classic" | undefined;
  fontSize?: number | undefined;
  align?: "left" | "center" | "right" | undefined;
};
export function photoFrame(
  appearance: PageAppearance | undefined,
  cover: boolean,
  caption: boolean,
  duo = false,
) {
  const margin = (appearance?.margin ?? 6) / 100;
  const bottom = margin === 0 ? 0 : cover ? 0.32 : caption ? 0.2 : margin;
  const gap = margin === 0 ? 0.02 : 0.05;
  return {
    margin,
    bottom,
    gap,
    width: (1 - margin * 2) * (duo ? (1 - gap) / 2 : 1),
    height: 1 - margin - bottom,
  };
}
export function pageStyle(
  appearance: PageAppearance | undefined,
  cover: boolean,
  caption: boolean,
  widthIn: number,
) {
  const frame = photoFrame(appearance, cover, caption);
  const family = {
    sans: '"DM Sans", Arial, sans-serif',
    serif: "Georgia, serif",
    classic: '"Times New Roman", serif',
  };
  return {
    "--page-margin": `${frame.margin * 100}%`,
    "--photo-bottom": `${frame.bottom * 100}%`,
    "--photo-gap": `${frame.gap * 100}%`,
    "--page-font": family[appearance?.font ?? "sans"],
    "--page-align": appearance?.align ?? "center",
    ...(appearance?.fontSize
      ? {
          "--page-font-size": `${(appearance.fontSize / (Math.max(widthIn, 1) * 72)) * 100}cqw`,
        }
      : {}),
  };
}
export function pageWidthIn(
  options: { kind: string; width?: number; unit?: string }[],
) {
  const size = options.find((o) => o.kind === "dimension");
  return (
    (size?.width || 8) *
    (size?.unit === "mm" ? 1 / 25.4 : size?.unit === "cm" ? 1 / 2.54 : 1)
  );
}
