require('dotenv').config();

const app = require('./app');
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\nAxomPrep Admin running at http://localhost:${PORT}`);
  console.log(`Login: ${process.env.ADMIN_USERNAME || 'admin'}\n`);
});
