/** `#rrggbb` → `#rrggbbaa`, for day shading that keeps text and bars readable. */
export const translucent = (color: string, alpha = '1f') => `${color}${alpha}`;

/** Soft fill for event chips (paired with a solid left accent line). */
export const soft = (color: string) => `${color}2b`;
