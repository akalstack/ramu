-- Ramu's own tables: plain Postgres (text, bytea, timestamptz, indexes), so any provider's Postgres serves them.
-- Every row belongs to one user and goes with them on Delete account.

-- A device code is also the user's, so deleting the account removes it.
alter table "deviceCode" add constraint "deviceCode_userId_fk" foreign key ("userId") references "user" ("id") on delete cascade;

-- One slot per host or phone. The slot id is chosen by the device and opaque; its name is sealed like the backups.
create table backup_slot (
  id uuid primary key,
  user_id text not null references "user" ("id") on delete cascade,
  slot text not null,
  kind text not null check (kind in ('host', 'phone')),
  label bytea not null,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  unique (user_id, slot)
);

-- The last 30 versions of each slot, sealed on the device before upload.
create table backup_version (
  id bigserial primary key,
  slot_id uuid not null references backup_slot (id) on delete cascade,
  ciphertext bytea not null,
  size integer not null,
  created_at timestamptz not null default now()
);
create index backup_version_slot_idx on backup_version (slot_id, created_at desc);

-- The backup key sealed under a key derived from the person's recovery code.
create table recovery_key (
  user_id text primary key references "user" ("id") on delete cascade,
  sealed bytea not null,
  updated_at timestamptz not null default now()
);

-- A new device asking a device it trusts for the backup key: commit, offer, reveal, then the sealed key.
create table key_request (
  id uuid primary key,
  user_id text not null references "user" ("id") on delete cascade,
  session_id text not null,
  name text not null,
  commit_hash text not null,
  requester_key text,
  approver_key text,
  envelope bytea,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index key_request_user_idx on key_request (user_id, expires_at);

-- Hosts the person listed in their account: a name, its public key and when it was last seen; never an address.
create table listed_host (
  id uuid primary key,
  user_id text not null references "user" ("id") on delete cascade,
  host_key text not null,
  name text not null,
  last_seen timestamptz not null default now(),
  unique (user_id, host_key)
);

-- Pairing messages relayed between a signed-in device and a listed host. The service passes the pairing exchange's
-- messages, which carry no secret; what the host sends back that is private is sealed to the device.
create table relay_message (
  id uuid primary key,
  host_id uuid not null references listed_host (id) on delete cascade,
  session_id text not null,
  path text not null,
  body text not null,
  reply text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index relay_message_host_idx on relay_message (host_id, reply, expires_at);
