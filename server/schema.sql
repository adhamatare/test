-- Menu database schema (PostgreSQL). Safe to run more than once.

CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS venues (
  key      text PRIMARY KEY,
  ar       text NOT NULL DEFAULT '',
  position int  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sections (
  id        serial PRIMARY KEY,
  venue_key text NOT NULL REFERENCES venues(key) ON DELETE CASCADE ON UPDATE CASCADE,
  en        text NOT NULL,
  ar        text NOT NULL DEFAULT '',
  position  int  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sections_venue_idx ON sections(venue_key, position);

CREATE TABLE IF NOT EXISTS items (
  id         text PRIMARY KEY,
  section_id int  NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  en         text NOT NULL,
  ar         text NOT NULL DEFAULT '',
  d_en       text NOT NULL DEFAULT '',
  d_ar       text NOT NULL DEFAULT '',
  price      numeric(10,2) NOT NULL CHECK (price >= 0),
  discount   int  NOT NULL DEFAULT 0 CHECK (discount BETWEEN 0 AND 100),
  pic        text NOT NULL DEFAULT '',
  is_new     boolean NOT NULL DEFAULT false,
  sold_out   boolean NOT NULL DEFAULT false,
  hidden     boolean NOT NULL DEFAULT false,
  position   int  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS items_section_idx ON items(section_id, position);

CREATE TABLE IF NOT EXISTS bundles (
  id       text PRIMARY KEY,
  en       text NOT NULL,
  ar       text NOT NULL DEFAULT '',
  d_en     text NOT NULL DEFAULT '',
  d_ar     text NOT NULL DEFAULT '',
  price    numeric(10,2) NOT NULL CHECK (price >= 0),
  pic      text NOT NULL DEFAULT '',
  is_new   boolean NOT NULL DEFAULT false,
  hidden   boolean NOT NULL DEFAULT false,
  position int  NOT NULL DEFAULT 0
);

-- Deleting an item removes it from every combo (the admin page did this by hand).
CREATE TABLE IF NOT EXISTS bundle_items (
  bundle_id text NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  item_id   text NOT NULL REFERENCES items(id)   ON DELETE CASCADE,
  qty       int  NOT NULL DEFAULT 1 CHECK (qty >= 1),
  position  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_id, item_id)
);
