// Tiny builders for screen-kit nodes with a Spanish text and its English twin, a toast, and whether the tab is on a TV.

export const toast = (t, role) => ({ toast: role ? { text: t.es, textEn: t.en, role } : t.es, toastEn: t.en });

export const Text = (t, extra = {}) => ({ type: "Text", text: t.es, textEn: t.en, ...extra });
export const Btn = (type, t, onPressed, extra = {}) => ({ type, labelText: t.es, labelTextEn: t.en, onPressed, ...extra });
export const Banner = (role, t, action) => ({ type: "MaterialBanner", role, text: t.es, textEn: t.en, ...(action ? { action } : {}) });
export const Action = (t, onTap, arg) => ({ label: t.es, labelEn: t.en, onTap, ...(arg !== undefined ? { arg } : {}) });

/** Whether the tab is drawn on a TV (the drawer or the pinned panel there): no clipboard, no camera. */
export const isTv = (ctx) => Boolean(ctx && ctx.device === "tv");
