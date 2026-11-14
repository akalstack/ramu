-- What a listed host does when a device on the same account asks to pair, as chosen at the host.
alter table listed_host
  add column trust text not null default 'ask' check (trust in ('ask', 'viewer', 'owner'));
