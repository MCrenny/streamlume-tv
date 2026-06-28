const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 80;
app.use(cors());
app.get(['/start.json', '/msx/start.json'], (req, res) => res.sendFile(path.join(__dirname, 'start.json')));
app.use(express.static(__dirname));
app.listen(PORT, () => console.log('Server running on ' + PORT));
