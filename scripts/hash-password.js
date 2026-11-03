// Usage: npm run hash-password -- "my secret password"
import bcrypt from 'bcryptjs';

const password = process.argv[2];
if (!password) {
    console.error('Usage: npm run hash-password -- "<password>"');
    process.exit(1);
}
console.log(bcrypt.hashSync(password, 12));
