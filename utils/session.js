const sessionMap = new Map();

function getSession(chatId) {
  return sessionMap.get(String(chatId)) || null;
}

function setSession(chatId, session) {
  sessionMap.set(String(chatId), session);
}

function clearSession(chatId) {
  sessionMap.delete(String(chatId));
}

function updateSession(chatId, updates) {
  const session = getSession(chatId) || {};
  setSession(chatId, { ...session, ...updates });
}

module.exports = { getSession, setSession, clearSession, updateSession };
