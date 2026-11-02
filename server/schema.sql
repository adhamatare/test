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

CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  username      text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (lower(username));

-- Only a hash of the session token is stored, so a leaked database cannot be used to log in.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id    int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

-- Orders keep a snapshot of names and prices, so editing the menu later never changes history.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 100001;

CREATE TABLE IF NOT EXISTS orders (
  id           serial PRIMARY KEY,
  number       int  NOT NULL UNIQUE DEFAULT nextval('order_number_seq'),
  status       text NOT NULL DEFAULT 'open',
  type         text NOT NULL CHECK (type IN ('dinein','takeaway','delivery')),
  customer     text NOT NULL,
  table_no     text NOT NULL DEFAULT '',
  phone        text NOT NULL DEFAULT '',
  address      text NOT NULL DEFAULT '',
  area         text NOT NULL DEFAULT '',
  note         text NOT NULL DEFAULT '',
  subtotal     numeric(10,2) NOT NULL,
  delivery_fee numeric(10,2) NOT NULL DEFAULT 0,
  savings      numeric(10,2) NOT NULL DEFAULT 0,
  total        numeric(10,2) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- Order status: open > picked > in_progress > ready (ready for pickup), or cancelled.
-- This block also upgrades databases created with earlier status names.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
UPDATE orders SET status = CASE status WHEN 'new' THEN 'open' WHEN 'preparing' THEN 'in_progress' ELSE 'ready' END
 WHERE status IN ('new', 'preparing', 'done', 'completed');
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'open';
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('open','picked','in_progress','ready','cancelled'));

-- Secret the customer's browser holds, so only they can look up their order's status.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS track_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '');

CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status, created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id         serial PRIMARY KEY,
  order_id   int  NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ref        text NOT NULL,              -- item id, or "b:<id>" for a combo
  name       text NOT NULL,
  parts      text NOT NULL DEFAULT '',   -- what a combo contains
  unit_price numeric(10,2) NOT NULL,
  qty        int  NOT NULL CHECK (qty >= 1),
  note       text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);

-- Deleting an item removes it from every combo (the admin page did this by hand).
CREATE TABLE IF NOT EXISTS bundle_items (
  bundle_id text NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  item_id   text NOT NULL REFERENCES items(id)   ON DELETE CASCADE,
  qty       int  NOT NULL DEFAULT 1 CHECK (qty >= 1),
  position  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_id, item_id)
);
