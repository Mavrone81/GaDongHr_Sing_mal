'use strict';
require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 4022;
app.listen(PORT, () => console.log(`[statutory-my-service] listening on ${PORT}`));
