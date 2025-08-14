// hash_password.js
const bcrypt = require('bcryptjs');

const passwordToHash = 'admin12345'; // <-- CHANGE THIS to your desired password

async function hashPassword() {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(passwordToHash, salt);
    console.log('Hashed Password:', hashedPassword);
}

hashPassword();