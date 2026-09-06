export const parsePlanJson = JSON.parse;
export const planToJson = JSON.stringify;
export const promptValueToText = value => Array.isArray(value) ? value.join('\n') : String(value || '');
