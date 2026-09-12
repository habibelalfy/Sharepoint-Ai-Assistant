#!/usr/bin/env node
/**
 * Mints an HMAC-signed bearer token for the gateway's chat UI.
 *
 * Usage:
 *   npm run mint-token -- <userId>    (defaults to "demo-user")
 */
import { createHmac } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const userId = process.argv[2] ?? 'demo-user';
const secret = process.env.JWT_SIGNING_KEY ?? 'changeme';
const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const header = encode({ alg: 'HS256', typ: 'JWT' });
const payload = encode({ sub: userId, exp });
const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');

console.log(`${header}.${payload}.${signature}`);
