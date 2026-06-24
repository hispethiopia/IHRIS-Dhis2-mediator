"use strict";
const crypto = require("crypto");

const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours

// Map<token, { user, expiresAt }>
const sessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { user, expiresAt: Date.now() + SESSION_TTL });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (Date.now() > sess.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return sess;
}

function destroySession(token) {
  sessions.delete(token);
}

function parseSidCookie(req) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === "sid") return v.join("=");
  }
  return null;
}

function requireAuth(req, res, next) {
  // Requests forwarded by OpenHIM carry this header — treat them as trusted internal calls
  if (req.headers["x-openhim-transactionid"]) return next();

  const token = parseSidCookie(req);
  const sess = getSession(token);
  if (!sess) return res.status(401).json({ error: "Unauthorized — please sign in" });
  req.sessionToken = token;
  req.sessionUser = sess.user;
  next();
}

module.exports = { createSession, getSession, destroySession, parseSidCookie, requireAuth };
