/** Suggestions only: admins can type any unit or category. */
export const UNIT_SUGGESTIONS = ["each", "bag", "container", "box", "plate", "slice", "pie", "bottle", "can", "combo"];
export const CATEGORY_SUGGESTIONS = ["Sweets", "Savory", "Meals", "Drinks", "Snacks", "Combos"];

/** Signups are normally 1 to 100. Larger amounts need an explicit "large quantity" tick. */
export const NORMAL_SIGNUP_MAX = 100;
export const ABSOLUTE_SIGNUP_MAX = 10000;

/** A login on a checkout device lasts one long sale day. */
export const SESSION_HOURS = 14;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 5;

/** A cashier can void their own sale this long after ringing it up. */
export const VOID_WINDOW_MINUTES = 15;
/** Two sales to the same customer for the same total this close together are flagged. */
export const DUPLICATE_WINDOW_MINUTES = 5;
export const MAX_LINE_QTY = 999;
