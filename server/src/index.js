import { createApp } from "./app.js";
import { setup } from "./setup.js";

await setup();
const port = Number(process.env.PORT) || 3000;
createApp().listen(port, () => console.log(`Menu API on http://localhost:${port}`));
