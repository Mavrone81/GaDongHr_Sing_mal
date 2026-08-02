'use strict';
require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 4021;
app.listen(PORT, () => console.log(`[statutory-sg-service] listening on ${PORT}`));
