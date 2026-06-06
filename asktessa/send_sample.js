const fs = require('fs');
const http = require('http');

const body = fs.readFileSync('sample.json', 'utf8');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/tessa/ask',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log(data);
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.error('Request error:', err.message);
  process.exit(1);
});

req.write(body);
req.end();
