import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { config } from '../config/index.js';

export const ROLES = Object.freeze({ CLIENT: 'client', FREELANCER: 'freelancer', ADMIN: 'admin' });

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), required: true },
    roles: { type: [String], enum: Object.values(ROLES), required: true },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, select: false, default: '' },
    emailVerificationExpiresAt: { type: Date, select: false },
    status: { type: String, enum: ['active', 'suspended', 'banned'], default: 'active' },
    lastActiveAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

userSchema.methods.setPassword = async function setPassword(plainPassword) {
  this.passwordHash = await bcrypt.hash(plainPassword, config.bcryptCost);
};

userSchema.methods.comparePassword = function comparePassword(plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash || '');
};

userSchema.methods.hasRole = function hasRole(role) {
  return this.role === role || this.roles.includes(role);
};

userSchema.methods.toJSON = function toJSON() {
  const user = this.toObject();
  delete user.passwordHash;
  delete user.emailVerificationTokenHash;
  delete user.emailVerificationExpiresAt;
  return user;
};

export const User = mongoose.model('User', userSchema);
