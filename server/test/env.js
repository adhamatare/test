// Must be the FIRST import of every test file. Points the app at a throwaway test database
// before anything reads DATABASE_URL, and refuses to run against anything that is not one.
const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!base) throw new Error("Set DATABASE_URL (server/.env) or TEST_DATABASE_URL before running the tests.");

const url = new URL(base);
if (!process.env.TEST_DATABASE_URL && !url.pathname.slice(1).endsWith("_test")) url.pathname += "_test";   // menu -> menu_test
const dbName = url.pathname.slice(1);

if (!dbName.endsWith("_test")) throw new Error(`Refusing to run tests: the database "${dbName}" does not end in _test.`);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) && process.env.TEST_ALLOW_REMOTE !== "1") {
  throw new Error(`Refusing to run tests against ${url.hostname}. Tests wipe their database; set TEST_ALLOW_REMOTE=1 only for a disposable one.`);
}

const admin = new URL(url);
admin.pathname = "/postgres";
process.env.TEST_ADMIN_URL = admin.toString();   // used only to create the test database if it is missing
process.env.TEST_DB_NAME = dbName;
process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = "test";
delete process.env.ADMIN_USERNAME;               // a test that needs a first admin sets these itself
delete process.env.ADMIN_PASSWORD;
