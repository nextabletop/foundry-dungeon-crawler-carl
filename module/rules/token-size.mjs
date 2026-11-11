// Roll20's token widths in pixels, normalized to its 70px grid.
const SIZE_PIXELS = [70, 25, 35, 50, 70, 140, 210, 280, 350, 420, 490, 560, 630, 700];
const SIZE_DESCRIPTOR = /\b(?:tiny|small|petite|medium|large|huge|gargantuan|colossal)\s*\(\s*(\d+)\s*\)/i;

/** Return grid units for a numbered Mob size, or null when no size is present. */
export const mobTokenSize = (descriptors) => {
  const match = SIZE_DESCRIPTOR.exec(String(descriptors ?? ''));
  if (!match) return null;
  return (SIZE_PIXELS[Number(match[1])] ?? SIZE_PIXELS[0]) / 70;
};
