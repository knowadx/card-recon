export const MERCURY_BASE = "https://api.mercury.com/api/v1";

export const KEY_MAP: Record<string, string | undefined> = {
  activeview: process.env.MERCURY_API_KEY,
  "4ads": process.env.MERCURY_API_KEY_4ADS,
};
