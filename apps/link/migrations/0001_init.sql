-- Better Auth's tables (core, bearer and device authorization) and Ramu Link's host registry.
CREATE TABLE "user" (
  "id" text NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" integer NOT NULL,
  "image" text,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL
);
CREATE TABLE "session" (
  "id" text NOT NULL PRIMARY KEY,
  "expiresAt" date NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON "session" ("userId");
CREATE TABLE "account" (
  "id" text NOT NULL PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL
);
CREATE INDEX "account_userId_idx" ON "account" ("userId");
CREATE TABLE "verification" (
  "id" text NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" date NOT NULL,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
CREATE TABLE "deviceCode" (
  "id" text NOT NULL PRIMARY KEY,
  "deviceCode" text NOT NULL UNIQUE,
  "userCode" text NOT NULL UNIQUE,
  "userId" text,
  "expiresAt" date NOT NULL,
  "status" text NOT NULL,
  "lastPolledAt" date,
  "pollingInterval" integer,
  "clientId" text,
  "scope" text
);
-- One row per linked host. The secret the host connects with is stored only as a SHA-256 hash.
CREATE TABLE "host" (
  "id" text NOT NULL PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "publicKey" text NOT NULL,
  "secretHash" text NOT NULL,
  "online" integer NOT NULL DEFAULT 0,
  "lastSeenAt" integer,
  "createdAt" integer NOT NULL
);
CREATE INDEX "host_userId_idx" ON "host" ("userId");
