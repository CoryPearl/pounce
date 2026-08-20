const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const registerSocketHandlers = require('./server/socketHandlers');
const { RoomManager } = require('./server/roomManager');
const { getNetworkAddresses } = require('./server/utils');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const roomManager = new RoomManager();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ ok: true }));

registerSocketHandlers(io, roomManager);

server.listen(PORT, HOST, () => {
  const network = getNetworkAddresses(PORT);
  console.log('Pounce server running!');
  console.log('');
  console.log(`Local:\nhttp://localhost:${PORT}`);
  if (network.length) {
    console.log('');
    console.log(`Network:\n${network.join('\n')}`);
  }
});
