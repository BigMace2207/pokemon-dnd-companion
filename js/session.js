// The account session token (see js/account.js). Kept in its own tiny module
// so network.js can attach it to requests without importing account.js,
// which itself depends on network.js through storage.js.

const TOKEN_KEY = "pokemon-dnd-session";

export function getSessionToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setSessionToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked -- sign-in just won't persist */ }
}
