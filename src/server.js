import http from 'node:http';
import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { config } from './config/index.js';

async function start() {
  await connectDB();
  const server = http.createServer(createApp());
  server.listen(config.port, () => console.log(`Giggo API listening on http://localhost:${config.port}`));

  const shutdown = async () => {
    await new Promise((resolve) => server.close(resolve));
    await disconnectDB();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((error) => {
  console.error('Giggo API failed to start:', error.message);
  process.exit(1);
});
