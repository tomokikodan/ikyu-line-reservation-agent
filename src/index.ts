import { config } from "./config.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(config.PORT, "0.0.0.0", () => {
  console.log(`LINE reservation agent listening on 0.0.0.0:${config.PORT}`);
});
