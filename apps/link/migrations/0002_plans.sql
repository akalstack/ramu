-- Relayed time per account per UTC day, written when a stream closes or the relay goes quiet, never per frame. The
-- account is the host's owner: whoever links a host carries its relayed time, including streams from shared accounts.
CREATE TABLE "usage" (
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "day" text NOT NULL,
  "seconds" integer NOT NULL DEFAULT 0,
  "frames" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("userId", "day")
);
-- What an account has and until when, never how it paid. Written only by payment webhooks.
CREATE TABLE "entitlement" (
  "userId" text NOT NULL PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  "plan" text NOT NULL,
  "source" text NOT NULL,
  "expiresAt" integer,
  "renews" integer NOT NULL DEFAULT 0,
  "subscriptionId" text,
  -- Paddle's own state for the subscription (active, past_due, paused, canceled), so deleting an account cancels any
  -- subscription Paddle might still charge.
  "subscriptionStatus" text,
  "updatedAt" integer NOT NULL
);
CREATE INDEX "entitlement_subscriptionId_idx" ON "entitlement" ("subscriptionId");
-- Accounts a host's owner lets reach that host through the relay. The host still pairs them, and only as viewers.
CREATE TABLE "share" (
  "hostId" text NOT NULL REFERENCES "host" ("id") ON DELETE CASCADE,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "createdAt" integer NOT NULL,
  PRIMARY KEY ("hostId", "userId")
);
CREATE INDEX "share_userId_idx" ON "share" ("userId");
