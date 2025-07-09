// File: hash-password.js
const bcrypt = require('bcryptjs');

// !!! IMPORTANT: Replace this with the strong password you want to use !!!
const plainTextPassword = 'admin12345';

if (plainTextPassword === 'admin12345!') {
    console.error("\x1b[31m%s\x1b[0m", "ERROR: Please change the placeholder password in the script before running.");
    return;
}

const salt = bcrypt.genSaltSync(10);
const hashedPassword = bcrypt.hashSync(plainTextPassword, salt);

console.log('\n--- Generated Bcrypt Hash ---\n');
console.log("Keep this hash secure. You will paste this entire string into MongoDB Atlas.");
console.log("\x1b[32m%s\x1b[0m", hashedPassword); // Prints the hash in green
console.log('\n---------------------------\n');