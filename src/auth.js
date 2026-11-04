import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'agcro-mvp-secure-jwt-secret-key-do-not-use-in-production-2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

export async function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password, hash) {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

export function hashToken(token) {
  if (!token || typeof token !== 'string') return '';
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

export function generateToken(user) {
  const jti = crypto.randomUUID();
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    farmerId: user.farmerId || null,
    name: user.name || user.username,
    jti
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  return { token, jti };
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function authMiddleware(store) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication token required in Authorization header (Bearer <token>)'
      });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Bearer token missing'
      });
    }

    const tokenHash = hashToken(token);
    if (store.isTokenRevoked(tokenHash)) {
      return res.status(401).json({
        error: 'token_revoked',
        message: 'Token has been revoked. Please log in again.'
      });
    }

    try {
      const decoded = verifyToken(token);
      if (decoded.jti && store.isTokenRevoked(decoded.jti)) {
        return res.status(401).json({
          error: 'token_revoked',
          message: 'Token session has been revoked. Please log in again.'
        });
      }

      const user = store.getUserById(decoded.id);
      if (!user) {
        return res.status(401).json({
          error: 'user_not_found',
          message: 'Authenticated user account no longer exists.'
        });
      }

      req.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        farmerId: user.farmerId,
        name: user.name
      };
      req.token = token;
      req.tokenHash = tokenHash;
      req.jti = decoded.jti;
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'token_expired',
          message: 'Authentication token has expired. Please log in again.'
        });
      }
      return res.status(401).json({
        error: 'invalid_token',
        message: 'Invalid authentication token'
      });
    }
  };
}

export function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication required'
      });
    }

    // Explicitly reject any caller-supplied x-agcro-role spoofing
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'forbidden',
        message: `Access denied. Required role: ${roles.join(' or ')}`
      });
    }
    next();
  };
}

export const requireAdmin = requireRole('ADMIN');

export function checkFarmOwnership(user, farm) {
  if (!user || !farm) return false;
  if (user.role === 'ADMIN') return true;
  if (user.role === 'FARMER') {
    return farm.farmerId === user.farmerId || farm.farmerId === user.id;
  }
  return false;
}

export function deviceAuthMiddleware(store) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'device_unauthorized',
        message: 'Device authentication token required (Bearer <token>)'
      });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({
        error: 'device_unauthorized',
        message: 'Device bearer token missing'
      });
    }

    // First check if this is an authenticated user submitting a reading
    try {
      const decoded = verifyToken(token);
      const user = store.getUserById(decoded.id);
      if (user && !store.isTokenRevoked(decoded.jti) && !store.isTokenRevoked(hashToken(token))) {
        req.user = {
          id: user.id,
          username: user.username,
          role: user.role,
          farmerId: user.farmerId,
          name: user.name
        };
        req.authType = 'user';
        return next();
      }
    } catch {
      // Not a user JWT; proceed to check as device credential
    }

    const tokenH = hashToken(token);
    const device = store.getDeviceByTokenHash(tokenH);
    if (!device) {
      return res.status(401).json({
        error: 'device_unauthorized',
        message: 'Invalid or unregistered device token'
      });
    }

    if (device.status === 'revoked') {
      return res.status(403).json({
        error: 'device_revoked',
        message: 'Sensor device access has been revoked by administration'
      });
    }

    req.device = device;
    req.authType = 'device';
    next();
  };
}

