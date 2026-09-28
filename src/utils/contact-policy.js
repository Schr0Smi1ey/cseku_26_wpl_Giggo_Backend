const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+\d{1,3}[\s-]?)?(?:\d[\s-]){2,}\d{4,}/;
const EXTERNAL_MESSENGER_PATTERN = /\b(?:whats?app|telegram|discord|skype|imo|viber)\b/i;

export function containsExternalContact(value = '') {
  return EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value) || EXTERNAL_MESSENGER_PATTERN.test(value);
}
