import CryptoJS from 'crypto-js';
import { Transaction, RecurringTransaction, RecurringException } from '../types';

const INTERNAL_APP_SALT = 'cashflow_secure_salt_987234_app_salt';

/**
 * Derives a deterministic 256-bit encryption key from user's unique Supabase identifier.
 */
export function deriveEncryptionKey(userId: string): string {
  return CryptoJS.SHA256(userId + INTERNAL_APP_SALT).toString();
}

/**
 * Encrypt a string value with the derived key.
 */
export function encryptValue(value: string, key: string): string {
  if (!value) return '';
  return CryptoJS.AES.encrypt(value, key).toString();
}

/**
 * Decrypt a ciphertext string back with the derived key.
 */
export function decryptValue(cipherText: string, key: string): string {
  if (!cipherText) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(cipherText, key);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return decrypted || cipherText; // Fall back to original on fail
  } catch (e) {
    console.error('Decryption failed for value, returning raw ciphertext:', e);
    return cipherText;
  }
}

/**
 * Encrypts app states before uploading to Supabase
 */
export function encryptAppPayload(
  initialBalance: number,
  transactions: Transaction[],
  recurringTransactions: RecurringTransaction[],
  recurringExceptions: RecurringException[],
  key: string
) {
  // 1. Initial Balance
  const initialBalanceEnc = encryptValue(String(initialBalance), key);

  // 2. Transactions
  const encryptedTransactions = transactions.map((t) => ({
    id: t.id,
    date: encryptValue(t.date, key),
    type: encryptValue(t.type, key),
    amount: encryptValue(String(t.amount), key),
    memo: encryptValue(t.memo || '', key),
    isActive: t.isActive,
    isRecurring: t.isRecurring,
    recurringId: t.recurringId ? encryptValue(t.recurringId, key) : undefined,
  }));

  // 3. Recurring transactions
  const encryptedRecurring = recurringTransactions.map((r) => ({
    id: r.id,
    type: encryptValue(r.type, key),
    amount: encryptValue(String(r.amount), key),
    memo: encryptValue(r.memo || '', key),
    startDate: encryptValue(r.startDate, key),
    endDate: r.endDate ? encryptValue(r.endDate, key) : undefined,
    frequency: encryptValue(r.frequency, key),
    customInterval: r.customInterval ? encryptValue(String(r.customInterval), key) : undefined,
  }));

  // 4. Recurring Exceptions
  const encryptedExceptions = recurringExceptions.map((e) => ({
    recurringId: encryptValue(e.recurringId, key),
    date: encryptValue(e.date, key),
    isActive: e.isActive,
    isDeleted: e.isDeleted,
  }));

  return {
    initialBalanceEnc,
    transactionsEnc: JSON.stringify(encryptedTransactions),
    recurringTransactionsEnc: JSON.stringify(encryptedRecurring),
    recurringExceptionsEnc: JSON.stringify(encryptedExceptions),
  };
}

/**
 * Decrypts app states after downloading from Supabase
 */
export function decryptAppPayload(
  initialBalanceEnc: string,
  transactionsEncStr: string,
  recurringTransactionsEncStr: string,
  recurringExceptionsEncStr: string,
  key: string
): {
  initialBalance: number;
  transactions: Transaction[];
  recurringTransactions: RecurringTransaction[];
  recurringExceptions: RecurringException[];
} {
  // 1. Initial Balance
  let initialBalance = 1000000;
  if (initialBalanceEnc) {
    const decVal = decryptValue(initialBalanceEnc, key);
    if (decVal && !isNaN(Number(decVal))) {
      initialBalance = Number(decVal);
    }
  }

  // 2. Transactions
  let transactions: Transaction[] = [];
  if (transactionsEncStr) {
    try {
      const encryptedArr = JSON.parse(transactionsEncStr);
      if (Array.isArray(encryptedArr)) {
        transactions = encryptedArr.map((t: any) => ({
          id: t.id,
          date: decryptValue(t.date, key),
          type: decryptValue(t.type, key) as any,
          amount: Number(decryptValue(t.amount, key)) || 0,
          memo: decryptValue(t.memo, key),
          isActive: t.isActive,
          isRecurring: t.isRecurring,
          recurringId: t.recurringId ? decryptValue(t.recurringId, key) : undefined,
        }));
      }
    } catch (e) {
      console.error('Failed to parse and decrypt transactions:', e);
    }
  }

  // 3. Recurring Transactions
  let recurringTransactions: RecurringTransaction[] = [];
  if (recurringTransactionsEncStr) {
    try {
      const encryptedArr = JSON.parse(recurringTransactionsEncStr);
      if (Array.isArray(encryptedArr)) {
        recurringTransactions = encryptedArr.map((r: any) => ({
          id: r.id,
          type: decryptValue(r.type, key) as any,
          amount: Number(decryptValue(r.amount, key)) || 0,
          memo: decryptValue(r.memo, key),
          startDate: decryptValue(r.startDate, key),
          endDate: r.endDate ? decryptValue(r.endDate, key) : undefined,
          frequency: decryptValue(r.frequency, key) as any,
          customInterval: r.customInterval ? Number(decryptValue(r.customInterval, key)) : undefined,
        }));
      }
    } catch (e) {
      console.error('Failed to parse and decrypt recurring transactions:', e);
    }
  }

  // 4. Recurring Exceptions
  let recurringExceptions: RecurringException[] = [];
  if (recurringExceptionsEncStr) {
    try {
      const encryptedArr = JSON.parse(recurringExceptionsEncStr);
      if (Array.isArray(encryptedArr)) {
        recurringExceptions = encryptedArr.map((e: any) => ({
          recurringId: decryptValue(e.recurringId, key),
          date: decryptValue(e.date, key),
          isActive: e.isActive,
          isDeleted: e.isDeleted,
        }));
      }
    } catch (e) {
      console.error('Failed to parse and decrypt recurring exceptions:', e);
    }
  }

  return {
    initialBalance,
    transactions,
    recurringTransactions,
    recurringExceptions,
  };
}
