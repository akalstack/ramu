-- Webhook requests for a host that was offline, sealed to the host's identity key (only the host can open them), kept
-- for a day and handed over when the host reconnects.
CREATE TABLE "held_hook" (
  "id" text NOT NULL PRIMARY KEY,
  "hostId" text NOT NULL REFERENCES "host" ("id") ON DELETE CASCADE,
  "sealed" text NOT NULL,
  "receivedAt" integer NOT NULL,
  "expiresAt" integer NOT NULL
);
CREATE INDEX "held_hook_host_idx" ON "held_hook" ("hostId", "receivedAt");
