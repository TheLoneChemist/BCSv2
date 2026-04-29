// card-scanner-api v1.1.0-maintenance
import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// Serve maintenance page for all routes
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: '.' });
});

app.listen(port, () => {
  console.log(`Card scanner maintenance page running on port ${port}`);
});
