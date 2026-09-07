import { connectDB, disconnectDB } from '../src/config/db.js';
import { ROLES, User } from '../src/models/User.js';

const name = (process.env.ADMIN_NAME || '').trim();
const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';

if (!process.env.MONGODB_URI || !name || !email || !password) {
  console.error('Set MONGODB_URI, ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD before bootstrapping an administrator.');
  process.exitCode = 1;
} else {
  try {
    await connectDB();
    let user = await User.findOne({ email }).select('+passwordHash');
    if (!user) {
      user = new User({ name, email, role: ROLES.ADMIN, roles: [ROLES.ADMIN], emailVerified: true });
      await user.setPassword(password);
      await user.save();
      console.log(`Created administrator account for ${email}.`);
    } else {
      user.name = name;
      user.role = ROLES.ADMIN;
      user.roles = [...new Set([...(user.roles || []), ROLES.ADMIN])];
      await user.setPassword(password);
      await user.save();
      console.log(`Updated administrator access for ${email}.`);
    }
  } catch (error) {
    console.error(`Administrator bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
}
