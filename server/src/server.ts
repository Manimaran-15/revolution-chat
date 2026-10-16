import { config } from './config.js';
import { migrate, seed } from './db.js';
import { httpServer } from './socket.js';

migrate();
if (process.env.SEED_ON_START === 'true') await seed();
httpServer.listen(config.port, config.host, () => {
  console.log(`Revolution Chat server listening on http://${config.host}:${config.port}`);
  console.log(`Client origin: ${config.clientOrigin}`);
});
