/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  format, 
  addMonths, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  startOfWeek, 
  endOfWeek, 
  isSameMonth, 
  isSameDay, 
  addDays,
  parseISO
} from 'date-fns';
import { ko } from 'date-fns/locale';
import { 
  Plus, 
  ChevronLeft, 
  ChevronRight, 
  Trash2, 
  Edit2,
  ToggleLeft as ToggleOff, 
  ToggleRight as ToggleOn,
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  Calendar as CalendarIcon,
  Info,
  X,
  Menu,
  Download,
  Upload,
  Settings,
  HelpCircle,
  TrendingDown,
  AlertTriangle,
  Repeat,
  ChevronDown,
  ChevronUp,
  LogIn,
  LogOut,
  Copy,
  Check,
  Sun,
  Moon,
  Monitor
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import LZString from 'lz-string';
import pako from 'pako';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from 'recharts';

// --- Types ---
import { 
  TransactionType, 
  Transaction, 
  FrequencyType, 
  RecurringTransaction, 
  RecurringException 
} from './types';

// --- Supabase & Crypto Sync Helpers ---
import { getSupabase } from './lib/supabase';
import { deriveEncryptionKey, encryptAppPayload, decryptAppPayload } from './lib/crypto';


// --- Utils ---

const formatCurrencyGlobal = (amount: number) => {
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(amount);
};

// --- Extreme Compression & Flat Serialization helpers ---

const toBase36 = (num: number): string => {
  if (num < 0) return '-' + Math.abs(num).toString(36);
  return num.toString(36);
};

const fromBase36 = (str: string): number => {
  if (str.startsWith('-')) return -parseInt(str.slice(1), 36);
  return parseInt(str, 36);
};

const getDaysOffset = (dateStr: string, baseStr: string): number => {
  const date = new Date(dateStr);
  const base = new Date(baseStr);
  const diffTime = date.getTime() - base.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
};

const addDaysToDate = (baseStr: string, days: number): string => {
  const base = new Date(baseStr);
  base.setDate(base.getDate() + days);
  return format(base, 'yyyy-MM-dd');
};

const uint8ArrayToBase64 = (arr: Uint8Array): string => {
  let binary = '';
  const len = arr.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
};

const base64ToUint8Array = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const serializeDataV2 = (initialBalance: number, transactions: Transaction[]): string => {
  const baseDateStr = transactions.reduce(
    (min, t) => t.date < min ? t.date : min,
    format(new Date(), 'yyyy-MM-dd')
  );
  
  const header = `v2|${toBase36(initialBalance)}|${baseDateStr}`;
  
  const txStrings = transactions.map(t => {
    const offset = getDaysOffset(t.date, baseDateStr);
    const typeCode = t.type === 'income' ? 'I' : 'E';
    const amountStr = toBase36(t.amount);
    const activeStr = t.isActive ? '1' : '0';
    const escapedMemo = t.memo
      .replace(/\\/g, '\\\\')
      .replace(/,/g, '\\c')
      .replace(/;/g, '\\s')
      .replace(/\|/g, '\\b')
      .replace(/#/g, '\\h');
    
    return `${toBase36(offset)},${typeCode},${amountStr},${activeStr},${escapedMemo}`;
  });
  
  return `${header}#${txStrings.join(';')}`;
};

const deserializeDataV2 = (serialized: string): { initialBalance: number; transactions: Transaction[] } => {
  if (!serialized.includes('#')) {
    throw new Error('Invalid format');
  }
  
  const [header, txSection] = serialized.split('#');
  const headerParts = header.split('|');
  if (headerParts[0] !== 'v2') {
    throw new Error('Unsupported version');
  }
  
  const initialBalance = fromBase36(headerParts[1]);
  const baseDateStr = headerParts[2];
  
  const transactionsList: Transaction[] = [];
  if (txSection.trim()) {
    const txParts = txSection.split(';');
    txParts.forEach(txStr => {
      if (!txStr.trim()) return;
      const parts = txStr.split(',');
      const offset = fromBase36(parts[0]);
      const typeCode = parts[1];
      const amount = fromBase36(parts[2]);
      const isActive = parts[3] === '1';
      
      let unescapedMemo = parts.slice(4).join(',');
      unescapedMemo = unescapedMemo
        .replace(/\\c/g, ',')
        .replace(/\\s/g, ';')
        .replace(/\\b/g, '|')
        .replace(/\\h/g, '#')
        .replace(/\\\\/g, '\\');
      
      const date = addDaysToDate(baseDateStr, offset);
      const id = Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5);
      
      transactionsList.push({
        id,
        date,
        type: typeCode === 'I' ? 'income' : 'expense',
        amount,
        memo: unescapedMemo,
        isActive
      });
    });
  }
  
  return { initialBalance, transactions: transactionsList };
};

const escapeStr = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\c')
    .replace(/;/g, '\\s')
    .replace(/\|/g, '\\b')
    .replace(/#/g, '\\h');
};

const unescapeStr = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/\\c/g, ',')
    .replace(/\\s/g, ';')
    .replace(/\\b/g, '|')
    .replace(/\\h/g, '#')
    .replace(/\\\\/g, '\\');
};

const serializeDataV3 = (
  initialBalance: number,
  transactions: Transaction[],
  recurringTransactions: RecurringTransaction[] = [],
  recurringExceptions: RecurringException[] = []
): string => {
  const baseDateStr = [
    ...transactions.map(t => t.date.slice(0, 10)),
    ...recurringTransactions.map(r => r.startDate),
    ...recurringTransactions.filter(r => r.endDate).map(r => r.endDate!),
    ...recurringExceptions.map(e => e.date)
  ].reduce(
    (min, d) => d < min ? d : min,
    format(new Date(), 'yyyy-MM-dd')
  );

  const header = `v3|${toBase36(initialBalance)}|${baseDateStr}`;

  // Establish sequential ID mapping for recurring transactions to save space (0, 1, 2...)
  const recIdMap = new Map<string, string>();
  recurringTransactions.forEach((r, idx) => {
    recIdMap.set(r.id, toBase36(idx));
  });

  // Section 1: Standard transactions (ID is auto-generated on import to save precious space)
  const txStrings = transactions.map(t => {
    const offset = getDaysOffset(t.date, baseDateStr);
    const typeCode = t.type === 'income' ? 'I' : 'E';
    const amountStr = toBase36(t.amount);
    const activeStr = t.isActive ? '1' : '0';
    const isRecStr = t.isRecurring ? '1' : '0';
    const recIdMapped = t.recurringId ? (recIdMap.get(t.recurringId) ?? '') : '';
    const escMemo = escapeStr(t.memo);

    return `${toBase36(offset)},${typeCode},${amountStr},${activeStr},${isRecStr},${recIdMapped},${escMemo}`;
  });

  // Section 2: Recurring rules (using sequential mapping keys instead of full random IDs)
  const recStrings = recurringTransactions.map((r, idx) => {
    const mappedId = toBase36(idx);
    const startOffset = getDaysOffset(r.startDate, baseDateStr);
    const endOffset = r.endDate ? getDaysOffset(r.endDate, baseDateStr) : '';
    const typeCode = r.type === 'income' ? 'I' : 'E';
    const amountStr = toBase36(r.amount);
    const customIntervalStr = r.customInterval ? toBase36(r.customInterval) : '';
    const escMemo = escapeStr(r.memo);

    let freqCode = 'M';
    if (r.frequency === 'daily') freqCode = 'D';
    else if (r.frequency === 'weekly') freqCode = 'W';
    else if (r.frequency === 'custom') freqCode = 'C';

    return `${mappedId},${typeCode},${amountStr},${toBase36(startOffset)},${endOffset !== '' ? toBase36(endOffset) : ''},${freqCode},${customIntervalStr},${escMemo}`;
  });

  // Section 3: Exceptions (using sequential mapped recurring ID)
  const excStrings = recurringExceptions.map(e => {
    const mappedRecId = recIdMap.get(e.recurringId) ?? '';
    const offset = getDaysOffset(e.date, baseDateStr);
    const activeStr = e.isActive === false ? '0' : (e.isActive === true ? '1' : '');
    const delStr = e.isDeleted === true ? '1' : '';

    return `${mappedRecId},${toBase36(offset)},${activeStr},${delStr}`;
  });

  return `${header}#${txStrings.join(';')}#${recStrings.join(';')}#${excStrings.join(';')}`;
};

const deserializeDataV3 = (serialized: string): {
  initialBalance: number;
  transactions: Transaction[];
  recurringTransactions: RecurringTransaction[];
  recurringExceptions: RecurringException[];
} => {
  const sections = serialized.split('#');
  const header = sections[0];
  const headerParts = header.split('|');
  if (headerParts[0] !== 'v3') {
    throw new Error('Unsupported version');
  }

  const initialBalance = fromBase36(headerParts[1]);
  const baseDateStr = headerParts[2];

  const transactionsList: Transaction[] = [];
  const recurringList: RecurringTransaction[] = [];
  const exceptionsList: RecurringException[] = [];

  const recIdNewMap = new Map<string, string>(); // oldMappedId (e.g., "0", "1") -> newUniqueId

  // Section 2: Recurring rules (Parsed first to rebuild recIdNewMap mapping context)
  const recSection = sections[2];
  if (recSection && recSection.trim()) {
    recSection.split(';').forEach(recStr => {
      if (!recStr.trim()) return;
      const parts = recStr.split(',');
      if (parts.length < 8) return;
      const oldMappedId = parts[0];
      const typeCode = parts[1];
      const amount = fromBase36(parts[2]);
      const startOffset = fromBase36(parts[3]);
      const endOffsetStr = parts[4];
      const freqCode = parts[5];
      const customIntervalStr = parts[6];

      let memo = parts.slice(7).join(',');
      memo = unescapeStr(memo);

      const startDate = addDaysToDate(baseDateStr, startOffset);
      const endDate = endOffsetStr ? addDaysToDate(baseDateStr, fromBase36(endOffsetStr)) : undefined;

      let frequency: FrequencyType = 'monthly';
      if (freqCode === 'D') frequency = 'daily';
      else if (freqCode === 'W') frequency = 'weekly';
      else if (freqCode === 'C') frequency = 'custom';

      const customInterval = customIntervalStr ? fromBase36(customIntervalStr) : undefined;
      
      const newId = 'rec-' + Math.random().toString(36).substr(2, 9);
      recIdNewMap.set(oldMappedId, newId);

      recurringList.push({
        id: newId,
        type: typeCode === 'I' ? 'income' : 'expense',
        amount,
        memo,
        startDate,
        endDate,
        frequency,
        customInterval
      });
    });
  }

  // Section 1: Transactions
  let txCounter = 0;
  const txSection = sections[1];
  if (txSection && txSection.trim()) {
    txSection.split(';').forEach(txStr => {
      if (!txStr.trim()) return;
      const parts = txStr.split(',');
      if (parts.length < 7) return;
      const offset = fromBase36(parts[0]);
      const typeCode = parts[1];
      const amount = fromBase36(parts[2]);
      const isActive = parts[3] === '1';
      const isRecurring = parts[4] === '1';
      const oldRecId = parts[5];
      const newRecId = oldRecId ? (recIdNewMap.get(oldRecId) ?? oldRecId) : undefined;
      
      let memo = parts.slice(6).join(',');
      memo = unescapeStr(memo);

      const date = addDaysToDate(baseDateStr, offset);
      const id = 'imp-' + Date.now().toString(36) + '-' + (txCounter++).toString(36) + '-' + Math.random().toString(36).substr(2, 4);

      transactionsList.push({
        id,
        date,
        type: typeCode === 'I' ? 'income' : 'expense',
        amount,
        memo,
        isActive,
        isRecurring,
        recurringId: newRecId
      });
    });
  }

  // Section 3: Exceptions
  const excSection = sections[3];
  if (excSection && excSection.trim()) {
    excSection.split(';').forEach(excStr => {
      if (!excStr.trim()) return;
      const parts = excStr.split(',');
      if (parts.length < 4) return;
      const oldRecId = parts[0];
      const newRecId = recIdNewMap.get(oldRecId) ?? oldRecId;
      const offset = fromBase36(parts[1]);
      const activeStr = parts[2];
      const delStr = parts[3];

      const date = addDaysToDate(baseDateStr, offset);
      const isActive = activeStr === '1' ? true : (activeStr === '0' ? false : undefined);
      const isDeleted = delStr === '1' ? true : undefined;

      exceptionsList.push({
        recurringId: newRecId,
        date,
        isActive,
        isDeleted
      });
    });
  }

  return {
    initialBalance,
    transactions: transactionsList,
    recurringTransactions: recurringList,
    recurringExceptions: exceptionsList
  };
};

// --- Recurring Rules Helpers ---

const getOccurrenceOnDate = (rule: RecurringTransaction, date: Date): boolean => {
  const ruleStart = parseISO(rule.startDate);
  const dStart = new Date(ruleStart.getFullYear(), ruleStart.getMonth(), ruleStart.getDate());
  const dTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  
  if (dTarget < dStart) return false;
  if (rule.endDate) {
    const ruleEnd = parseISO(rule.endDate);
    const dEndClean = new Date(ruleEnd.getFullYear(), ruleEnd.getMonth(), ruleEnd.getDate());
    if (dTarget > dEndClean) return false;
  }
  
  const diffTime = dTarget.getTime() - dStart.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  
  switch (rule.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return diffDays % 7 === 0;
    case 'custom': {
      const interval = rule.customInterval || 1;
      return diffDays % interval === 0;
    }
    case 'monthly': {
      const startDay = ruleStart.getDate();
      const targetMonthLastDay = new Date(dTarget.getFullYear(), dTarget.getMonth() + 1, 0).getDate();
      const expectedDay = Math.min(startDay, targetMonthLastDay);
      return dTarget.getDate() === expectedDay;
    }
    default:
      return false;
  }
};

const getTransactionsForDate = (
  date: Date,
  txList: Transaction[],
  rules: RecurringTransaction[],
  exceptions: RecurringException[]
): Transaction[] => {
  const dateStr = format(date, 'yyyy-MM-dd');
  const currentMonthStart = startOfMonth(new Date());

  // 1. Filter standard manual & archived transactions for this date
  const standardTxs = txList.filter(t => {
    try {
      return isSameDay(parseISO(t.date), date);
    } catch (e) {
      return false;
    }
  });

  // 2. If the date is in a past month, we only return the standard transactions (which include any archived ones)
  if (date < currentMonthStart) {
    return standardTxs;
  }

  // 3. For current/future dates, we also evaluate the recurring transactions
  const dynamicTxs: Transaction[] = [];

  rules.forEach(rule => {
    if (getOccurrenceOnDate(rule, date)) {
      const exception = exceptions.find(e => e.recurringId === rule.id && e.date === dateStr);
      
      if (exception) {
        if (exception.isDeleted) {
          return;
        }
        if (exception.isActive === false) {
          dynamicTxs.push({
            id: `dynamic-${rule.id}-${dateStr}`,
            date: date.toISOString(),
            type: rule.type,
            amount: rule.amount,
            memo: rule.memo,
            isActive: false,
            recurringId: rule.id,
            isRecurring: true
          });
          return;
        }
      }

      const hasStandalone = standardTxs.some(t => t.recurringId === rule.id);
      if (hasStandalone) return;

      dynamicTxs.push({
        id: `dynamic-${rule.id}-${dateStr}`,
        date: date.toISOString(),
        type: rule.type,
        amount: rule.amount,
        memo: rule.memo,
        isActive: true,
        recurringId: rule.id,
        isRecurring: true
      });
    }
  });

  return [...standardTxs, ...dynamicTxs];
};

const archivePastRecurringInstances = (
  rules: RecurringTransaction[],
  exceptions: RecurringException[],
  currentTxList: Transaction[]
): { updatedTxs: Transaction[]; updatedExceptions: RecurringException[] } => {
  const today = new Date();
  const currentMonthStart = startOfMonth(today);
  
  const updatedTxs = [...currentTxList];
  let changed = false;

  rules.forEach(rule => {
    try {
      const ruleStart = parseISO(rule.startDate);
      const ruleStartClean = new Date(ruleStart.getFullYear(), ruleStart.getMonth(), ruleStart.getDate());
      
      if (ruleStartClean >= currentMonthStart) return;

      const archiveEnd = addDays(currentMonthStart, -1);
      const daysToCheck = eachDayOfInterval({ start: ruleStartClean, end: archiveEnd });
      
      daysToCheck.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        
        if (getOccurrenceOnDate(rule, day)) {
          const exception = exceptions.find(e => e.recurringId === rule.id && e.date === dateStr);
          
          if (exception && exception.isDeleted) return;

          const alreadyExists = updatedTxs.some(t => {
            return t.recurringId === rule.id && isSameDay(parseISO(t.date), day);
          });

          if (!alreadyExists) {
            if (exception && exception.isActive === false) {
              return;
            }
            
            const archivedTx: Transaction = {
              id: `archived-${rule.id}-${dateStr}`,
              date: day.toISOString(),
              type: rule.type,
              amount: rule.amount,
              memo: rule.memo ? `${rule.memo} (고정)` : '고정 지출 항목',
              isActive: true,
              recurringId: rule.id,
              isRecurring: true
            };
            updatedTxs.push(archivedTx);
            changed = true;
          }
        }
      });
    } catch (e) {
      console.error(e);
    }
  });

  return { updatedTxs, updatedExceptions: exceptions };
};

const parseDynamicId = (id: string): { ruleId: string; dateStr: string } => {
  const cleanId = id.replace('dynamic-', '');
  const dateStr = cleanId.slice(-10); // yyyy-MM-dd is always 10 characters
  const ruleId = cleanId.slice(0, -11); // everything before that last hyphen
  return { ruleId, dateStr };
};

const getFirstOccurrenceOnOrAfter = (rule: RecurringTransaction, minDate: Date): Date => {
  const ruleStart = parseISO(rule.startDate);
  const minClean = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
  
  const dStart = new Date(ruleStart.getFullYear(), ruleStart.getMonth(), ruleStart.getDate());
  if (dStart >= minClean) {
    return dStart;
  }

  if (rule.frequency === 'monthly') {
    const startDay = ruleStart.getDate();
    let checkMonth = new Date(minClean.getFullYear(), minClean.getMonth(), 1);
    for (let i = 0; i < 120; i++) {
      const targetMonthLastDay = new Date(checkMonth.getFullYear(), checkMonth.getMonth() + 1, 0).getDate();
      const expectedDay = Math.min(startDay, targetMonthLastDay);
      const possibleDate = new Date(checkMonth.getFullYear(), checkMonth.getMonth(), expectedDay);
      if (possibleDate >= minClean) {
        return possibleDate;
      }
      checkMonth = addMonths(checkMonth, 1);
    }
    return minClean;
  }

  let current = dStart;
  let iterations = 0;
  while (current < minClean && iterations < 5000) {
    iterations++;
    switch (rule.frequency) {
      case 'daily':
        current = addDays(current, 1);
        break;
      case 'weekly':
        current = addDays(current, 7);
        break;
      case 'custom': {
        const interval = rule.customInterval || 1;
        current = addDays(current, interval);
        break;
      }
      default:
        return minClean;
    }
  }
  return current;
};

// --- Components ---

export default function App() {
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cashFlow_themeMode');
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        return saved;
      }
    }
    return 'system';
  });

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cashFlow_themeMode') || 'system';
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('cashFlow_themeMode', themeMode);

    const applyTheme = () => {
      let effectiveDark = false;
      if (themeMode === 'dark') {
        effectiveDark = true;
      } else if (themeMode === 'light') {
        effectiveDark = false;
      } else {
        effectiveDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }

      setIsDarkMode(effectiveDark);
      const root = document.documentElement;
      if (effectiveDark) {
        root.classList.add('dark');
        root.classList.remove('light');
      } else {
        root.classList.add('light');
        root.classList.remove('dark');
      }
    };

    applyTheme();

    if (themeMode === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = (e: MediaQueryListEvent) => {
        applyTheme();
      };
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    }
  }, [themeMode]);

  const [initialBalance, setInitialBalance] = useState<number>(() => {
    const saved = localStorage.getItem('cashFlow_initialBalance');
    return saved ? Number(saved) : 1000000;
  });
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem('cashFlow_transactions');
    return saved ? JSON.parse(saved) : [];
  });

  // Recurring Transactions and Exceptions States
  const [recurringTransactions, setRecurringTransactions] = useState<RecurringTransaction[]>(() => {
    const saved = localStorage.getItem('cashFlow_recurringTransactions');
    return saved ? JSON.parse(saved) : [];
  });
  const [recurringExceptions, setRecurringExceptions] = useState<RecurringException[]>(() => {
    const saved = localStorage.getItem('cashFlow_recurringExceptions');
    return saved ? JSON.parse(saved) : [];
  });

  const [activeTab, setActiveTab] = useState<'settings' | 'calendar' | 'recurring'>('calendar');
  const [sidebarTab, setSidebarTab] = useState<'detail' | 'recurring' | 'settings'>('detail');

  // --- Supabase Cloud Sync & Authentication States ---
  const [supabaseUser, setSupabaseUser] = useState<any>(null);
  const [isCloudSyncing, setIsCloudSyncing] = useState<boolean>(false);
  const [cloudSyncError, setCloudSyncError] = useState<string>('');
  const [isConflictModalOpen, setIsConflictModalOpen] = useState<boolean>(false);
  const [pendingCloudData, setPendingCloudData] = useState<any>(null);
  const [hasInitializedAuth, setHasInitializedAuth] = useState<boolean>(false);
  const [isSqlHelpOpen, setIsSqlHelpOpen] = useState<boolean>(false);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  // Google OAuth popup check & close mechanism
  useEffect(() => {
    const isCallback = window.location.hash.includes('access_token') || 
                       window.location.hash.includes('id_token') || 
                       window.location.search.includes('code=');
    if (window.opener && isCallback) {
      const supabase = getSupabase();
      if (!supabase) {
        try {
          window.opener.postMessage({ type: 'SUPABASE_AUTH_SUCCESS' }, '*');
        } catch (e) {}
        window.close();
        return;
      }

      console.log('Popup detected OAuth callback. Subscribing to auth state change...');
      
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string, session: any) => {
        if (session) {
          console.log('Session established in popup. Messaging opener and closing...', event);
          try {
            window.opener.postMessage({ 
              type: 'SUPABASE_AUTH_SUCCESS', 
              session: {
                access_token: session.access_token,
                refresh_token: session.refresh_token
              }
            }, '*');
          } catch (e) {
            console.error('Failed to postMessage to opener:', e);
          }
          setTimeout(() => {
            window.close();
          }, 300);
        }
      });

      // Quick active check
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          try {
            window.opener.postMessage({ 
              type: 'SUPABASE_AUTH_SUCCESS', 
              session: {
                access_token: session.access_token,
                refresh_token: session.refresh_token
              }
            }, '*');
          } catch (e) {}
          setTimeout(() => {
            window.close();
          }, 300);
        }
      });

      const timeoutId = setTimeout(() => {
        console.warn('Popup timeout reached, closing...');
        try {
          window.opener.postMessage({ type: 'SUPABASE_AUTH_SUCCESS' }, '*');
        } catch (e) {}
        window.close();
      }, 5000);

      return () => {
        subscription.unsubscribe();
        clearTimeout(timeoutId);
      };
    }
  }, []);

  // Supabase Auth and Popups Listener
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setHasInitializedAuth(true);
      return;
    }

    const handleOAuthMessage = (event: MessageEvent) => {
      const origin = event.origin;
      const isAllowedOrigin = 
        origin.endsWith('.run.app') || 
        origin.includes('localhost') || 
        origin.includes('vercel.app') || 
        origin === window.location.origin;

      if (!isAllowedOrigin) {
        return;
      }
      if (event.data?.type === 'SUPABASE_AUTH_SUCCESS') {
        console.log('Received auth success from popup, setting session...');
        const rxSession = event.data?.session;
        if (rxSession?.access_token && rxSession?.refresh_token) {
          supabase.auth.setSession({
            access_token: rxSession.access_token,
            refresh_token: rxSession.refresh_token
          }).then(({ data, error }) => {
            if (error) {
              console.error('setSession failed on parent:', error);
            }
            if (data?.user) {
              setSupabaseUser(data.user);
            }
          });
        } else {
          // Fallback, fetch session
          supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
              setSupabaseUser(session.user);
            }
          });
        }
      }
    };

    // Robust multi-layered fallback sync listeners
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key && e.key.includes('-auth-token')) {
        console.log('Detected storage auth change. Synchronizing parent session...');
        supabase.auth.getSession().then(({ data: { session } }) => {
          setSupabaseUser(session?.user ?? null);
        });
      }
    };

    const handleFocus = () => {
      console.log('Parent window focused. Re-checking session states...');
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSupabaseUser(session?.user ?? null);
      });
    };

    window.addEventListener('message', handleOAuthMessage);
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleFocus);

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setSupabaseUser(session.user);
      }
      setHasInitializedAuth(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSupabaseUser(session?.user ?? null);
      setHasInitializedAuth(true);
    });

    return () => {
      window.removeEventListener('message', handleOAuthMessage);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleFocus);
      subscription.unsubscribe();
    };
  }, []);

  // Google Login popup-based OAuth handler
  const handleGoogleLogin = async () => {
    const supabase = getSupabase();
    if (!supabase) {
      alert('Supabase가 활성화되지 않았습니다.');
      return;
    }
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`,
          skipBrowserRedirect: true, // Prevents parent iframe from redirecting to Google, preventing 403 pages
        }
      });
      if (error) throw error;
      if (data?.url) {
        const width = 500;
        const height = 650;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        const popup = window.open(
          data.url,
          'supabase_auth_popup',
          `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
        );
        if (!popup) {
          alert('팝업 차단을 해제하고 다시 시도해 주세요.');
        }
      }
    } catch (err: any) {
      console.error('Login error:', err);
      alert('구글 로그인 설정 중 오류가 발생했습니다: ' + err.message);
    }
  };

  // Sign out behavior
  const handleSignOut = async () => {
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.error('Error signing out of Supabase:', e);
      }
    }

    // Securely wipe local React states
    setInitialBalance(1000000);
    setTransactions([]);
    setRecurringTransactions([]);
    setRecurringExceptions([]);

    // Securely wipe all cashFlow related localStorage keys
    localStorage.removeItem('cashFlow_initialBalance');
    localStorage.removeItem('cashFlow_transactions');
    localStorage.removeItem('cashFlow_recurringTransactions');
    localStorage.removeItem('cashFlow_recurringExceptions');
    localStorage.removeItem('cashFlow_months');
    
    if (supabaseUser) {
      localStorage.removeItem(`cashFlow_synced_${supabaseUser.id}`);
    }

    setSupabaseUser(null);
  };

  // Fetch Cloud data and resolve conflicts once on load/auth detection
  useEffect(() => {
    if (!hasInitializedAuth || !supabaseUser) return;
    
    const supabase = getSupabase();
    if (!supabase) return;

    const checkAndSyncOnLoad = async () => {
      setIsCloudSyncing(true);
      setCloudSyncError('');
      try {
        const { data, error } = await supabase
          .from('user_sync')
          .select('*')
          .eq('user_id', supabaseUser.id)
          .maybeSingle();

        if (error) {
          // Check if table schema is missing
          if (error.code === '42P01') {
            setCloudSyncError('Supabase에 user_sync 테이블이 생성되지 않았습니다.\n아래의 [Supabase 테이블 및 RLS 설정 가이드]에 따라 SQL을 실행해 주세요.');
            return;
          }
          throw error;
        }

        const hasLocalData = transactions.length > 0 || initialBalance !== 1000000 || recurringTransactions.length > 0 || recurringExceptions.length > 0;
        const hasSyncedOnDevice = localStorage.getItem(`cashFlow_synced_${supabaseUser.id}`) === 'true';

        if (data) {
          const key = deriveEncryptionKey(supabaseUser.id);
          const decrypted = decryptAppPayload(
            data.initial_balance_enc,
            data.transactions_enc,
            data.recurring_transactions_enc,
            data.recurring_exceptions_enc,
            key
          );

          const hasCloudData = decrypted.transactions.length > 0 || decrypted.initialBalance !== 1000000 || decrypted.recurringTransactions.length > 0;

          if (hasLocalData && hasCloudData && !hasSyncedOnDevice) {
            setPendingCloudData(decrypted);
            setIsConflictModalOpen(true);
          } else {
            setInitialBalance(decrypted.initialBalance);
            setTransactions(decrypted.transactions);
            setRecurringTransactions(decrypted.recurringTransactions);
            setRecurringExceptions(decrypted.recurringExceptions);
            localStorage.setItem(`cashFlow_synced_${supabaseUser.id}`, 'true');
          }
        } else {
          if (hasLocalData) {
            const key = deriveEncryptionKey(supabaseUser.id);
            const payload = encryptAppPayload(
              initialBalance,
              transactions,
              recurringTransactions,
              recurringExceptions,
              key
            );

            const { error: insertError } = await supabase
              .from('user_sync')
              .upsert({
                user_id: supabaseUser.id,
                initial_balance_enc: payload.initialBalanceEnc,
                transactions_enc: payload.transactionsEnc,
                recurring_transactions_enc: payload.recurringTransactionsEnc,
                recurring_exceptions_enc: payload.recurringExceptionsEnc,
                updated_at: new Date().toISOString()
              });

            if (insertError) {
              console.warn('Initial push to cloud failed:', insertError);
              const errMsg = insertError?.message || String(insertError);
              const errCode = insertError?.code ? `[코드: ${insertError.code}] ` : '';
              const errDetails = insertError?.details ? ` (${insertError.details})` : '';
              setCloudSyncError(`데이터 클라우드 업로드에 실패했습니다.\n${errCode}${errMsg}${errDetails}\n\n⚠️ Supabase의 user_sync 테이블 설정이나 승인(RLS) 정책 오류일 수 있습니다. 아래의 가이드를 참조해 테이블 및 RLS 설정을 꼭 완료해 주세요.`);
            } else {
              localStorage.setItem(`cashFlow_synced_${supabaseUser.id}`, 'true');
            }
          } else {
            localStorage.setItem(`cashFlow_synced_${supabaseUser.id}`, 'true');
          }
        }
      } catch (err: any) {
        console.error('Error checking cloud sync on load:', err);
        const errMsg = err?.message || String(err);
        const errCode = err?.code ? `[코드: ${err.code}] ` : '';
        const errDetails = err?.details ? ` (${err.details})` : '';
        setCloudSyncError(`서버에서 동기화 데이터를 가져오는 중 오류가 발생했습니다.\n${errCode}${errMsg}${errDetails}\n\n💡 Supabase 프로젝트에 user_sync 테이블이 없거나, RLS(행 보안 권한) 정책이 올바르게 구성되지 않았을 가능성이 큽니다. 아래의 2단계 해결 가이드를 따라 설치해 주세요!`);
      } finally {
        setIsCloudSyncing(false);
      }
    };

    checkAndSyncOnLoad();
  }, [hasInitializedAuth, supabaseUser?.id]);

  // Handle overwrite local with cloud
  const handleOverwriteLocalWithCloud = () => {
    if (pendingCloudData) {
      setInitialBalance(pendingCloudData.initialBalance);
      setTransactions(pendingCloudData.transactions);
      setRecurringTransactions(pendingCloudData.recurringTransactions);
      setRecurringExceptions(pendingCloudData.recurringExceptions);
      if (supabaseUser) {
        localStorage.setItem(`cashFlow_synced_${supabaseUser.id}`, 'true');
      }
    }
    setIsConflictModalOpen(false);
    setPendingCloudData(null);
  };

  // Handle overwrite cloud with local
  const handleOverwriteCloudWithLocal = async () => {
    if (!supabaseUser) return;
    const supabase = getSupabase();
    if (!supabase) return;

    setIsCloudSyncing(true);
    setCloudSyncError('');
    try {
      const key = deriveEncryptionKey(supabaseUser.id);
      const payload = encryptAppPayload(
        initialBalance,
        transactions,
        recurringTransactions,
        recurringExceptions,
        key
      );

      const { error } = await supabase
        .from('user_sync')
        .upsert({
          user_id: supabaseUser.id,
          initial_balance_enc: payload.initialBalanceEnc,
          transactions_enc: payload.transactionsEnc,
          recurring_transactions_enc: payload.recurringTransactionsEnc,
          recurring_exceptions_enc: payload.recurringExceptionsEnc,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;
      localStorage.setItem(`cashFlow_synced_${supabaseUser.id}`, 'true');
    } catch (err: any) {
      console.error('Failed to overwrite cloud data:', err);
      const errMsg = err?.message || String(err);
      const errCode = err?.code ? `[코드: ${err.code}] ` : '';
      setCloudSyncError(`클라우드에 데이터를 동기화하는 중 오류가 발생했습니다.\n${errCode}${errMsg}`);
    } finally {
      setIsCloudSyncing(false);
      setIsConflictModalOpen(false);
      setPendingCloudData(null);
    }
  };

  // Mutation Sync to Supabase cloud (Background push with debouncing)
  useEffect(() => {
    if (!hasInitializedAuth || !supabaseUser) return;
    
    const hasSyncedOnDevice = localStorage.getItem(`cashFlow_synced_${supabaseUser.id}`) === 'true';
    if (!hasSyncedOnDevice) return;

    const supabase = getSupabase();
    if (!supabase) return;

    const timer = setTimeout(async () => {
      setIsCloudSyncing(true);
      try {
        const key = deriveEncryptionKey(supabaseUser.id);
        const payload = encryptAppPayload(
          initialBalance,
          transactions,
          recurringTransactions,
          recurringExceptions,
          key
        );

        const { error } = await supabase
          .from('user_sync')
          .upsert({
            user_id: supabaseUser.id,
            initial_balance_enc: payload.initialBalanceEnc,
            transactions_enc: payload.transactionsEnc,
            recurring_transactions_enc: payload.recurringTransactionsEnc,
            recurring_exceptions_enc: payload.recurringExceptionsEnc,
            updated_at: new Date().toISOString()
          });

        if (error) throw error;
        console.log('Auto-saved state safely to Supabase Cloud.');
      } catch (err) {
        console.error('Background mutation sync failed:', err);
      } finally {
        setIsCloudSyncing(false);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [initialBalance, transactions, recurringTransactions, recurringExceptions, supabaseUser?.id, hasInitializedAuth]);

  const [editingRecurringScope, setEditingRecurringScope] = useState<'instance' | 'series'>('instance');
  const [deletingDynamicId, setDeletingDynamicId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('cashFlow_initialBalance', initialBalance.toString());
  }, [initialBalance]);

  useEffect(() => {
    localStorage.setItem('cashFlow_transactions', JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem('cashFlow_recurringTransactions', JSON.stringify(recurringTransactions));
  }, [recurringTransactions]);

  useEffect(() => {
    localStorage.setItem('cashFlow_recurringExceptions', JSON.stringify(recurringExceptions));
  }, [recurringExceptions]);

  // Archive past recurring instances at startup
  useEffect(() => {
    const result = archivePastRecurringInstances(recurringTransactions, recurringExceptions, transactions);
    if (result.updatedTxs.length !== transactions.length) {
      setTransactions(result.updatedTxs);
    }
  }, []);

  // Sync activeTab with sidebarTab for mobile vs desktop switching
  useEffect(() => {
    if (activeTab === 'settings') {
      setSidebarTab('settings');
    } else if (activeTab === 'recurring') {
      setSidebarTab('recurring');
    }
  }, [activeTab]);

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [keepInitialBalance, setKeepInitialBalance] = useState(false);
  const [keepFutureRecurringRules, setKeepFutureRecurringRules] = useState(false);
  const [keepPastRecurringRecords, setKeepPastRecurringRecords] = useState(false);
  const [keepTodayAndFutureRecords, setKeepTodayAndFutureRecords] = useState(false);
  const [isResetOptionsExpanded, setIsResetOptionsExpanded] = useState(false);
  const [isDataSyncModalOpen, setIsDataSyncModalOpen] = useState(false);
  const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false);
  const [dataSyncMode, setDataSyncMode] = useState<'export' | 'import'>('export');
  const [syncText, setSyncText] = useState('');
  const [syncError, setSyncError] = useState('');
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [isDeathValleyModalOpen, setIsDeathValleyModalOpen] = useState(false);
  const [titleTapCount, setTitleTapCount] = useState(0);
  const [showEasterEgg, setShowEasterEgg] = useState(false);
  const [isComradeMode, setIsComradeMode] = useState(false);
  const [lang, setLang] = useState<'ko' | 'en'>('ko');

  const amountInputRef = useRef<HTMLInputElement>(null);

  const t = (str: string) => {
    if (!isComradeMode) return str;
    const dict: Record<string, string> = {
      'Balance Calendar': '자금 류통 달력',
      'Finance Simulation': '배급표 계산기',
      '기초 자산 설정': '기본 배급량 설정',
      '총 수입 (예정)': '총 배급 (계획)',
      '총 지출 (예정)': '총 소모 (계획)',
      '기말 잔액': '최종 보관량',
      '기록 추가하기': '동향 보고하기',
      '데이터 초기화': '자료 혁명',
      '내보내기': '반출',
      '불러오기': '반입',
      '수입': '배급',
      '지출': '소모',
      '내용 (선택)': '사연 (선택)',
      '금액': '액수',
      '날짜': '공작 날자',
      '취소': '무효화',
      '저장하기': '보존하기',
      '삭제': '숙청',
      '데이터 내보내기': '자료 반출',
      '데이터 불러오기': '자료 반입',
      '이곳에 텍스트를 붙여넣으세요...': '이곳에 암호문을 기입하시라요...',
      '텍스트 복사하기': '암호문 베끼기',
      '데이터 적용하기': '자료 결속하기',
      '이전 달력 추가': '지난 달력 덧붙이기',
      '다음 달력 추가': '다음 달력 덧붙이기',
      '앱 사용 가이드': '인민 생활 규범',
      '앱 사용법': '인민 생활 규범',
      '내역 관리하기': '과업 지도하기',
      '재정 시뮬레이션': '자금 조작 훈련',
      '설정 및 데이터 관리': '기밀 보존 및 설정',
      '내역 기입하기': '동향 등록하기',
      '시뮬레이션 토글': '시뮬레이션 조작',
      '무한 스크롤 달력': '끝없는 달력',
      '확인했어요!': '알갔시오!',
      '내역 수정': '과업 교정',
      '내역 추가': '내역 등록',
      '데이터를 입력해주세요.': '자료를 기입하시라요.',
      '잘못된 데이터 형식입니다.': '불순한 자료 형식입네다.',
      '유효하지 않은 데이터입니다.': '쓸모없는 자료입네다.',
      '텍스트가 복사되었습니다!': '암호문이 베껴졌시오!',
      '복사에 실패했습니다. 직접 선택하여 복사해주세요.': '베끼기에 실패했시오. 력량껏 베끼시라요.',
      '달력': '류통 장부',
      '고정지출': '배급계획',
      '설정': '통제실',
      '기본 설정 및 내역': '기본 자본 및 통제 규격',
      '고정 지출 관리': '정기 배급계획 통제',
      '월간 고정 흐름 분석': '월간 배급계획 총화',
      '등록된 모든 고정 규칙의 한 달 기준 환산 요약입니다.': '공화국 기본 계획에 기입된 배급 수령과 생활 소모의 월간 기획 총량입네다.',
      '고정 수입 (월)': '정기 배급 수령 (월)',
      '고정 지출 (월)': '정기 생활 소모 (월)',
      '순 고정 자금 (월)': '기대 순 배급량 (월)',
      '고정 내역 추가': '정기 배급계획 등록',
      '고정 내역 수정중': '정기 배급계획 개정중',
      '고정 규칙 수정 완료': '배급계획 개정 완료',
      '시뮬레이터 반영': '전투 상황판 반영',
      '추천 고정 항목 (원클릭 입력)': '추천 고정 항목 (원클릭 입력)',
      '내용 (메모)': '생활 명목 (메모)',
      '수입 사연 기입': '배급 세부 영수 사유 기입',
      '지출 사연 기입': '상납 세부 고발 사유 기입',
      '시작일': '개시 날자',
      '종료일 (옵션)': '종결 날자 (선택)',
      '발생 주기': '동원 주기',
      '매일': '매일정기 과업',
      '매주': '주간동원 과업',
      '매달': '월간 배급계획',
      '직접 입력': '사적인 동원 주기 (Custom)',
      '발생 간격 (일 단위)': '동원 간격 (일 단위)',
      '일 마다 발생': '일 마다 령 내려짐',
      '고정 규칙 생성하기': '배급 계획 결속하기',
      '등록 목록': '종합 배급 대장 목록',
      '전체': '전체 동향',
      '오늘 이후 내역 보존': '내일 이후 전투 보급 보존',
      '내일 이후 내역 보존': '내일 이후 전투 보급 보존',
      '어제까지의 과거 내역을 모두 지우고, 오늘 이후의 내역만 남겨둡니다.': '금일 및 그 이전 소모 보고를 전체 숙청하고, 내일 이후 기입된 전투 계획만을 보존합네다.',
      '오늘 포함 과거 내역을 모두 지우고, 내일 이후의 내역만 남겨둡니다.': '금일 및 그 이전 소모 보고를 전체 숙청하고, 내일 이후 기입된 전투 계획만을 보존합네다.',
    };
    return dict[str] || str;
  };

  const formatCurrency = (amount: number) => {
    const numStr = amount.toLocaleString();
    return isComradeMode ? `${numStr}억 원` : `${numStr}₩`;
  };

  const formatCalendarCompact = (amount: number) => {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';
    
    if (isComradeMode) {
      if (abs >= 10000) {
        const man = abs / 10000;
        const formatted = Number(man.toFixed(man % 1 === 0 ? 0 : 1));
        return `${sign}${formatted}만억`;
      }
      return `${sign}${abs.toLocaleString()}억`;
    }
    
    if (abs >= 100000000) {
      const eoc = abs / 100000000;
      const formatted = Number(eoc.toFixed(eoc % 1 === 0 ? 0 : 1));
      return `${sign}${formatted}억`;
    } else if (abs >= 10000) {
      const man = abs / 10000;
      const formatted = Number(man.toFixed(man % 1 === 0 ? 0 : 1));
      return `${sign}${formatted}만`;
    } else if (abs >= 1000) {
      const chun = abs / 1000;
      const formatted = Number(chun.toFixed(chun % 1 === 0 ? 0 : 1));
      return `${sign}${formatted}천`;
    }
    return `${sign}${abs}`;
  };

  // Form State
  const [formType, setFormType] = useState<TransactionType>('expense');
  const [formAmount, setFormAmount] = useState<string>('');
  const [formMemo, setFormMemo] = useState<string>('');
  const [formDate, setFormDate] = useState<Date>(new Date());

  // Recurring creation form state
  const [editingRecRuleId, setEditingRecRuleId] = useState<string | null>(null);
  const [recType, setRecType] = useState<TransactionType>('expense');
  const [recAmount, setRecAmount] = useState<string>('');
  const [recMemo, setRecMemo] = useState<string>('');
  const [recStartDate, setRecStartDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [recEndDate, setRecEndDate] = useState<string>('');
  const [recFrequency, setRecFrequency] = useState<FrequencyType>('monthly');
  const [recCustomInterval, setRecCustomInterval] = useState<number>(3);
  const [recFilter, setRecFilter] = useState<'all' | 'income' | 'expense'>('all');

  const [months, setMonths] = useState<Date[]>(() => {
    let savedMonths: Date[] = [];
    const saved = localStorage.getItem('cashFlow_months');
    if (saved) {
      try {
        savedMonths = JSON.parse(saved).map((d: string) => parseISO(d));
      } catch (e) {}
    }

    const now = new Date();
    let start = startOfMonth(now);
    let end = startOfMonth(addMonths(now, 1));

    if (savedMonths.length > 0) {
      start = savedMonths[0];
      end = savedMonths[savedMonths.length - 1];
    }

    if (transactions.length > 0) {
      const dates = transactions.map(t => parseISO(t.date));
      const minTransactionDate = startOfMonth(new Date(Math.min(...dates.map(d => d.getTime()))));
      const maxTransactionDate = startOfMonth(new Date(Math.max(...dates.map(d => d.getTime()))));

      if (minTransactionDate < start) start = minTransactionDate;
      if (maxTransactionDate > end) end = maxTransactionDate;
    }

    if (start > startOfMonth(now)) start = startOfMonth(now);
    if (end < startOfMonth(addMonths(now, 1))) end = startOfMonth(addMonths(now, 1));

    const generatedMonths: Date[] = [];
    let current = start;
    while (current <= end) {
      generatedMonths.push(current);
      current = startOfMonth(addMonths(current, 1));
    }
    
    return generatedMonths;
  });

  useEffect(() => {
    localStorage.setItem('cashFlow_months', JSON.stringify(months.map(m => m.toISOString())));
  }, [months]);

  useEffect(() => {
    if (transactions.length === 0) return;
    
    setMonths(prev => {
      let start = prev[0];
      let end = prev[prev.length - 1];
      
      const dates = transactions.map(t => parseISO(t.date));
      const times = dates.map(d => d.getTime());
      const minTransactionDate = startOfMonth(new Date(Math.min(...times)));
      const maxTransactionDate = startOfMonth(new Date(Math.max(...times)));

      let changed = false;
      if (minTransactionDate < start) {
        start = minTransactionDate;
        changed = true;
      }
      if (maxTransactionDate > end) {
        end = maxTransactionDate;
        changed = true;
      }

      if (!changed) return prev;

      const generatedMonths: Date[] = [];
      let current = start;
      while (current <= end) {
        generatedMonths.push(current);
        current = startOfMonth(addMonths(current, 1));
      }
      
      return generatedMonths;
    });
  }, [transactions]);

  const loadPreviousMonth = () => {
    setMonths(prev => [startOfMonth(addMonths(prev[0], -1)), ...prev]);
  };
  
  const loadNextMonth = () => {
    setMonths(prev => [...prev, startOfMonth(addMonths(prev[prev.length - 1], 1))]);
  };

  const handleTitleClick = () => {
    setTitleTapCount(prev => prev + 1);
    if (titleTapCount + 1 >= 5) {
      setIsComradeMode(prev => !prev);
      setShowEasterEgg(true);
      setTitleTapCount(0);
      setTimeout(() => setShowEasterEgg(false), 4000);
    }
  };

  useEffect(() => {
    if (titleTapCount > 0) {
      const t = setTimeout(() => setTitleTapCount(0), 1000);
      return () => clearTimeout(t);
    }
  }, [titleTapCount]);

  useEffect(() => {
    if (!isFormOpen) return;
    
    // Auto-focus the amount input
    const timer = setTimeout(() => {
      amountInputRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const target = e.target as HTMLElement;
        if (target.tagName.toLowerCase() === 'button') return;
        e.preventDefault();
        document.getElementById('save-btn')?.click();
      } else if (e.key === 'Escape') {
        setIsFormOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [isFormOpen]);

  // --- Logic ---

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const numericValue = e.target.value.replace(/[^0-9]/g, '');
    if (!numericValue) {
      setFormAmount('');
      return;
    }
    const formattedValue = new Intl.NumberFormat('ko-KR').format(Number(numericValue));
    setFormAmount(formattedValue);
  };

  const handleInitialBalanceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const numericValue = e.target.value.replace(/[^0-9]/g, '');
    setInitialBalance(Number(numericValue));
  };

  const handleReset = () => {
    const today = new Date();
    const tomorrow = addDays(today, 1);
    const tomorrowStr = format(tomorrow, 'yyyy-MM-dd');

    if (keepTodayAndFutureRecords) {
      // 1. 기초 자산 보존 (Do not clear initial balance)

      // 2. 반복 규칙 중 내일 이후 내용 보존 & 오늘 포함 과거 내용 삭제
      setRecurringTransactions(prev => prev.map(r => {
        const nextOccurrence = getFirstOccurrenceOnOrAfter(r, tomorrow);
        return {
          ...r,
          startDate: format(nextOccurrence, 'yyyy-MM-dd')
        };
      }));

      // Filter exceptions to only keep those scheduled tomorrow or in the future
      setRecurringExceptions(prev => prev.filter(e => e.date >= tomorrowStr));

      // 3. 오늘 포함 과거 개별 내역 삭제 + 내일 이후 내역만 보존
      let nextTransactions = [...transactions];
      nextTransactions = nextTransactions.filter(t => {
        try {
          const localDateStr = format(parseISO(t.date), 'yyyy-MM-dd');
          return localDateStr >= tomorrowStr;
        } catch (e) {
          return t.date.slice(0, 10) >= tomorrowStr;
        }
      });
      setTransactions(nextTransactions);

    } else {
      // Standard reset path based on other sub-options
      if (!keepInitialBalance) {
        setInitialBalance(0);
      }

      if (!keepFutureRecurringRules) {
        setRecurringTransactions([]);
        setRecurringExceptions([]);
      }

      let nextTransactions = [...transactions];
      if (!keepPastRecurringRecords) {
        nextTransactions = [];
      } else {
        // Preserve transactions where isRecurring is true, delete false or undefined
        nextTransactions = nextTransactions.filter(t => t.isRecurring === true);
      }
      setTransactions(nextTransactions);
    }

    const now = new Date();
    setMonths([startOfMonth(now), startOfMonth(addMonths(now, 1))]);
    setIsResetModalOpen(false);
  };

  const openDataSyncModal = (mode: 'export' | 'import') => {
    setDataSyncMode(mode);
    setSyncError('');
    if (mode === 'export') {
      try {
        const flatString = serializeDataV3(initialBalance, transactions, recurringTransactions, recurringExceptions);
        const compressedU8 = pako.deflate(flatString);
        const b64 = uint8ArrayToBase64(compressedU8);
        setSyncText(b64);
      } catch (err) {
        console.error('V3 export failed, falling back to V2:', err);
        try {
          const flatString = serializeDataV2(initialBalance, transactions);
          const compressedU8 = pako.deflate(flatString);
          const b64 = uint8ArrayToBase64(compressedU8);
          setSyncText(b64);
        } catch (err2) {
          console.error('V2 export failed, falling back to V1:', err2);
          const minifiedTransactions = transactions.map(t => [
            t.id,
            t.date,
            t.type === 'income' ? 'I' : 'E',
            t.amount,
            t.memo,
            t.isActive ? 1 : 0
          ]);
          const data = { v: 1, i: initialBalance, t: minifiedTransactions };
          const serialized = JSON.stringify(data);
          const encoded = LZString.compressToEncodedURIComponent(serialized);
          setSyncText(encoded);
        }
      }
    } else {
      setSyncText('');
    }
    setIsDataSyncModalOpen(true);
  };

  const handleImport = () => {
    if (!syncText.trim()) {
      setSyncError('데이터를 입력해주세요.');
      return;
    }
    const text = syncText.trim();
    
    // First try V3 or V2 (Compressed formats)
    try {
      const decompressedBinary = base64ToUint8Array(text);
      const inflatedText = pako.inflate(decompressedBinary, { to: 'string' });
      if (inflatedText.startsWith('v3|')) {
        const {
          initialBalance: importedInitialBalance,
          transactions: importedTransactions,
          recurringTransactions: importedRecurring,
          recurringExceptions: importedExceptions
        } = deserializeDataV3(inflatedText);
        
        setInitialBalance(importedInitialBalance);
        setTransactions(importedTransactions);
        setRecurringTransactions(importedRecurring);
        setRecurringExceptions(importedExceptions);
        setIsDataSyncModalOpen(false);
        return;
      } else if (inflatedText.startsWith('v2|')) {
        const { initialBalance: importedInitialBalance, transactions: importedTransactions } = deserializeDataV2(inflatedText);
        setInitialBalance(importedInitialBalance);
        setTransactions(importedTransactions);
        setRecurringTransactions([]);
        setRecurringExceptions([]);
        setIsDataSyncModalOpen(false);
        return;
      }
    } catch (e) {
      // Fail silently and try legacy fallbacks
    }

    try {
      let decoded = '';
      const decompressedURI = LZString.decompressFromEncodedURIComponent(text);
      const decompressedBase64 = LZString.decompressFromBase64(text);
      if (decompressedURI) {
        decoded = decompressedURI;
      } else if (decompressedBase64) {
        decoded = decompressedBase64;
      } else {
        // Fallback for old data encoded with btoa
        decoded = decodeURIComponent(atob(text));
      }
      const data = JSON.parse(decoded);
      
      let importedInitialBalance = 0;
      let importedTransactions: Transaction[] = [];

      if (data.v === 1) {
        importedInitialBalance = data.i;
        importedTransactions = data.t.map((t: any[]) => ({
          id: t[0],
          date: t[1],
          type: t[2] === 'I' ? 'income' : 'expense',
          amount: Number(t[3]),
          memo: t[4],
          isActive: Boolean(t[5])
        }));
      } else if (data.v === 3) {
        setInitialBalance(data.initialBalance ?? 0);
        setTransactions(data.transactions ?? []);
        setRecurringTransactions(data.recurringTransactions ?? []);
        setRecurringExceptions(data.recurringExceptions ?? []);
        setIsDataSyncModalOpen(false);
        return;
      } else if (typeof data.initialBalance === 'number' && Array.isArray(data.transactions)) {
        importedInitialBalance = data.initialBalance;
        importedTransactions = data.transactions;
      } else {
        setSyncError('잘못된 데이터 형식입니다.');
        return;
      }

      setInitialBalance(importedInitialBalance);
      setTransactions(importedTransactions);
      setRecurringTransactions([]);
      setRecurringExceptions([]);
      setIsDataSyncModalOpen(false);
    } catch (e) {
      setSyncError('유효하지 않은 데이터입니다.');
    }
  };

  const openForm = (date: Date, transaction?: Transaction, defaultType?: TransactionType) => {
    if (transaction) {
      setEditingId(transaction.id);
      setFormType(transaction.type);
      setFormAmount(new Intl.NumberFormat('ko-KR').format(transaction.amount));
      setFormMemo(transaction.memo);
      setFormDate(parseISO(transaction.date));
      if (transaction.id.startsWith('dynamic-')) {
        setEditingRecurringScope('instance');
      }
    } else {
      setEditingId(null);
      setFormType(defaultType || 'expense');
      setFormAmount('');
      setFormMemo('');
      setFormDate(date);
    }
    setSelectedDate(date);
    setIsFormOpen(true);
  };

  const addTransaction = () => {
    const rawAmount = Number(formAmount.replace(/,/g, ''));
    if (!rawAmount || isNaN(rawAmount)) return;

    if (editingId) {
      if (editingId.startsWith('dynamic-')) {
        const { ruleId, dateStr } = parseDynamicId(editingId);

        if (editingRecurringScope === 'instance') {
          // 1. Convert this dynamic occurrence to standard standalone transaction
          const newTransaction: Transaction = {
            id: Math.random().toString(36).substr(2, 9),
            date: formDate.toISOString(),
            type: formType,
            amount: rawAmount,
            memo: formMemo,
            isActive: true,
            recurringId: ruleId,
            isRecurring: true
          };
          setTransactions([...transactions, newTransaction]);

          // 2. Add full exception so dynamic generator skips it on this day
          setRecurringExceptions(prev => [...prev, { recurringId: ruleId, date: dateStr, isDeleted: true }]);
        } else {
          // Edit entire series
          setRecurringTransactions(prev => prev.map(r => 
            r.id === ruleId ? { ...r, type: formType, amount: rawAmount, memo: formMemo } : r
          ));
        }
      } else {
        // Standard transaction edit
        const existingTx = transactions.find(t => t.id === editingId);
        if (existingTx && existingTx.recurringId) {
          const oldDateStr = format(parseISO(existingTx.date), 'yyyy-MM-dd');
          const newDateStr = format(formDate, 'yyyy-MM-dd');
          if (oldDateStr !== newDateStr) {
            // Yes! The date has changed. Add exception for the old date so the recurring item of the series is deleted/hidden on that day
            setRecurringExceptions(prev => {
              const exists = prev.some(e => e.recurringId === existingTx.recurringId && e.date === oldDateStr && e.isDeleted);
              if (!exists) {
                return [...prev, { recurringId: existingTx.recurringId!, date: oldDateStr, isDeleted: true }];
              }
              return prev;
            });
          }
        }

        setTransactions(transactions.map(t => 
          t.id === editingId ? { ...t, type: formType, amount: rawAmount, memo: formMemo, date: formDate.toISOString() } : t
        ));
      }
    } else {
      // Create new standard transaction
      const newTransaction: Transaction = {
        id: Math.random().toString(36).substr(2, 9),
        date: formDate.toISOString(),
        type: formType,
        amount: rawAmount,
        memo: formMemo,
        isActive: true,
      };
      setTransactions([...transactions, newTransaction]);
    }

    setFormAmount('');
    setFormMemo('');
    setEditingId(null);
    setIsFormOpen(false);
  };

  const deleteTransaction = (id: string) => {
    if (id.startsWith('dynamic-')) {
      setDeletingDynamicId(id);
    } else {
      setTransactions(transactions.filter(t => t.id !== id));
    }
  };

  const confirmDeleteDynamicSegment = (scope: 'instance' | 'series') => {
    if (!deletingDynamicId) return;
    const { ruleId, dateStr } = parseDynamicId(deletingDynamicId);

    if (scope === 'instance') {
      setRecurringExceptions(prev => [...prev, { recurringId: ruleId, date: dateStr, isDeleted: true }]);
    } else {
      setRecurringTransactions(prev => prev.filter(r => r.id !== ruleId));
      setRecurringExceptions(prev => prev.filter(e => e.recurringId !== ruleId));
    }
    setDeletingDynamicId(null);
  };

  const toggleTransaction = (id: string) => {
    if (id.startsWith('dynamic-')) {
      const { ruleId, dateStr } = parseDynamicId(id);

      setRecurringExceptions(prev => {
        const existingIndex = prev.findIndex(e => e.recurringId === ruleId && e.date === dateStr);
        if (existingIndex > -1) {
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            isActive: !updated[existingIndex].isActive
          };
          return updated;
        } else {
          return [...prev, { recurringId: ruleId, date: dateStr, isActive: false }];
        }
      });
    } else {
      setTransactions(transactions.map(t => 
        t.id === id ? { ...t, isActive: !t.isActive } : t
      ));
    }
  };

  // --- Manage Recurring Items Logic ---

  const applyPreset = (preset: { memo: string; type: TransactionType; amount: number; frequency: FrequencyType; customInterval?: number }) => {
    setRecType(preset.type);
    setRecAmount(preset.amount.toLocaleString('ko-KR'));
    setRecMemo(preset.memo);
    setRecFrequency(preset.frequency);
    if (preset.customInterval) {
      setRecCustomInterval(preset.customInterval);
    }
  };

  const startEditRecurringRule = (rule: RecurringTransaction) => {
    setEditingRecRuleId(rule.id);
    setRecType(rule.type);
    setRecAmount(rule.amount.toLocaleString('ko-KR'));
    setRecMemo(rule.memo);
    setRecStartDate(rule.startDate);
    setRecEndDate(rule.endDate || '');
    setRecFrequency(rule.frequency);
    setRecCustomInterval(rule.customInterval || 3);
  };

  const cancelEditRecurringRule = () => {
    setEditingRecRuleId(null);
    setRecAmount('');
    setRecMemo('');
    setRecStartDate(format(new Date(), 'yyyy-MM-dd'));
    setRecEndDate('');
    setRecFrequency('monthly');
    setRecCustomInterval(3);
  };

  const addRecurringRule = () => {
    const rawAmount = Number(recAmount.replace(/,/g, ''));
    if (!rawAmount || isNaN(rawAmount)) {
      alert('금액을 올바르게 입력해주세요.');
      return;
    }
    if (!recStartDate) {
      alert('시작일을 입력해주세요.');
      return;
    }

    if (editingRecRuleId) {
      // Update existing recurring rule
      setRecurringTransactions(prev => prev.map(r => 
        r.id === editingRecRuleId
          ? {
              ...r,
              type: recType,
              amount: rawAmount,
              memo: recMemo || (recType === 'income' ? '고정 수입' : '고정 지출'),
              startDate: recStartDate,
              endDate: recEndDate || undefined,
              frequency: recFrequency,
              customInterval: recFrequency === 'custom' ? recCustomInterval : undefined
            }
          : r
      ));
      setEditingRecRuleId(null);
    } else {
      // Create new recurring rule
      const newRule: RecurringTransaction = {
        id: 'rec-' + Math.random().toString(36).substr(2, 9),
        type: recType,
        amount: rawAmount,
        memo: recMemo || (recType === 'income' ? '고정 수입' : '고정 지출'),
        startDate: recStartDate,
        endDate: recEndDate || undefined,
        frequency: recFrequency,
        customInterval: recFrequency === 'custom' ? recCustomInterval : undefined
      };

      setRecurringTransactions(prev => [...prev, newRule]);
    }

    setRecAmount('');
    setRecMemo('');
    setRecStartDate(format(new Date(), 'yyyy-MM-dd'));
    setRecEndDate('');
    setRecFrequency('monthly');
    setRecCustomInterval(3);

    const result = archivePastRecurringInstances(recurringTransactions, recurringExceptions, transactions);
    if (result.updatedTxs.length !== transactions.length) {
      setTransactions(result.updatedTxs);
    }
  };

  const deleteRecurringRule = (id: string) => {
    if (editingRecRuleId === id) {
      cancelEditRecurringRule();
    }
    setRecurringTransactions(prev => prev.filter(r => r.id !== id));
    setRecurringExceptions(prev => prev.filter(e => e.recurringId !== id));
  };

  const getFrequencyLabel = (rule: RecurringTransaction) => {
    try {
      const startStr = parseISO(rule.startDate);
      switch (rule.frequency) {
        case 'daily':
          return '매일';
        case 'weekly': {
          const dayOfWeek = format(startStr, 'EEEE', { locale: ko });
          return `매주 ${dayOfWeek}`;
        }
        case 'monthly': {
          const dayOfMonth = startStr.getDate();
          return `매달 ${dayOfMonth}일`;
        }
        case 'custom':
          return `${rule.customInterval}일마다`;
        default:
          return '';
      }
    } catch (e) {
      return '';
    }
  };

  const recurringOverview = useMemo(() => {
    let incomeTotalMonthly = 0;
    let expenseTotalMonthly = 0;

    recurringTransactions.forEach(rule => {
      let monthlyEquiv = 0;
      if (rule.frequency === 'daily') {
        monthlyEquiv = rule.amount * 30;
      } else if (rule.frequency === 'weekly') {
        monthlyEquiv = rule.amount * 4.33;
      } else if (rule.frequency === 'monthly') {
        monthlyEquiv = rule.amount;
      } else if (rule.frequency === 'custom' && rule.customInterval) {
        monthlyEquiv = (rule.amount * 30) / rule.customInterval;
      }

      if (rule.type === 'income') {
        incomeTotalMonthly += monthlyEquiv;
      } else {
        expenseTotalMonthly += monthlyEquiv;
      }
    });

    return {
      income: Math.round(incomeTotalMonthly),
      expense: Math.round(expenseTotalMonthly),
      net: Math.round(incomeTotalMonthly - expenseTotalMonthly),
    };
  }, [recurringTransactions]);

  // Calculate daily balances
  const simulationData = useMemo(() => {
    const startDate = startOfMonth(months[0]);
    const endDate = endOfMonth(months[months.length - 1]);
    const dayInterval = eachDayOfInterval({ start: startDate, end: endDate });

    const dailyStats: Record<string, { income: number; expense: number; balance: number }> = {};
    let cumulativeBalance = initialBalance;

    dayInterval.forEach(day => {
      const dateKey = format(day, 'yyyy-MM-dd');
      const dayTransactions = getTransactionsForDate(day, transactions, recurringTransactions, recurringExceptions);

      const activeTransactions = dayTransactions.filter(t => t.isActive);

      const income = activeTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);
      
      const expense = activeTransactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);

      cumulativeBalance = cumulativeBalance + income - expense;
      
      dailyStats[dateKey] = {
        income,
        expense,
        balance: cumulativeBalance
      };
    });

    return dailyStats;
  }, [transactions, recurringTransactions, recurringExceptions, initialBalance, months]);

  const deathValleyInfo = useMemo(() => {
    let minBalance = Infinity;
    let minDate = '';
    
    Object.entries(simulationData).forEach(([date, data]: [string, any]) => {
      if (data.balance < minBalance) {
        minBalance = data.balance;
        minDate = date;
      }
    });

    if (minBalance === Infinity || Object.keys(simulationData).length === 0) return null;
    return { date: parseISO(minDate), balance: minBalance };
  }, [simulationData]);

  const deathValleyChartData = useMemo(() => {
    const dataPoints = Object.entries(simulationData).map(([date, data]: [string, any]) => ({
      date,
      dateLabel: format(parseISO(date), 'M/d'),
      balance: data.balance
    }));
    
    if (dataPoints.length === 0) return [];

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    let startIndex = dataPoints.findIndex(p => p.date >= todayStr);
    if (startIndex === -1) startIndex = 0;
    
    let minIndex = startIndex;
    for (let i = startIndex; i < dataPoints.length; i++) {
        if (dataPoints[i].balance < dataPoints[minIndex].balance) {
            minIndex = i;
        }
    }

    startIndex = Math.max(0, startIndex - 2);
    let endIndex = Math.min(dataPoints.length - 1, Math.max(minIndex + 5, startIndex + 10));
    
    return dataPoints.slice(startIndex, endIndex + 1);
  }, [simulationData]);

  const removeMonth = (monthToRemove: Date) => {
    if (months.length <= 1) return;
    setMonths(months.filter(m => !isSameMonth(m, monthToRemove)));
  };

  const renderCalendar = (month: Date) => {
    const start = startOfWeek(startOfMonth(month));
    const end = endOfWeek(endOfMonth(month));
    const days = eachDayOfInterval({ start, end });

    return (
      <div key={month.toISOString()} className="flex-1 flex flex-col w-full">
        <div className="flex justify-between items-center mb-4 px-2 lg:px-0">
          <h2 className="text-[17px] sm:text-lg font-extrabold text-slate-800 break-keep">
            {isComradeMode 
              ? `주체 ${month.getFullYear() - 1911}(${month.getFullYear()})년 ${month.getMonth() + 1}월`
              : format(month, 'yyyy년 M월', { locale: ko })
            }
          </h2>
          {months.length > 1 && (
            <button 
              onClick={() => removeMonth(month)}
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-3xl transition-colors"
              title="달력 삭제"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        
        <div className="bg-slate-200 border border-slate-200 grid grid-cols-7 gap-[1px] rounded-xl overflow-hidden flex-1 border border-m3-surface-container-high shadow-xs mx-auto w-full">
          {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
            <div key={day} className="bg-m3-surface py-1.5 md:py-2 text-center text-[9px] md:text-[10px] font-bold text-gray-400 border-b border-m3-surface-container-high">
              {day}
            </div>
          ))}

          {days.map((day) => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const stats = simulationData[dateKey];
            const isSelected = isSameDay(day, selectedDate);
            const isToday = isSameDay(day, new Date());
            const isInMonth = isSameMonth(day, month);
            const dayTransactions = getTransactionsForDate(day, transactions, recurringTransactions, recurringExceptions);

            return (
              <div
                key={dateKey}
                onClick={() => {
                  setSelectedDate(day);
                  if (window.innerWidth < 1024) {
                    setIsBottomSheetOpen(true);
                  }
                }}
                onDoubleClick={() => openForm(day)}
                className={`
                  bg-m3-surface min-h-[66px] md:min-h-[85px] p-1 md:p-2 flex flex-col justify-between cursor-pointer transition-all w-full overflow-hidden
                  ${!isInMonth ? 'opacity-30 pointer-events-none' : 'hover:bg-m3-surface-container flex'}
                  ${isSelected && isInMonth ? 'ring-2 ring-inset ring-[#007AFF]/30 bg-blue-50/20' : ''}
                `}
              >
                <div className="flex justify-between items-start mb-0.5 shrink-0">
                  <span className={`
                    text-[10px] md:text-[13px] font-bold
                    ${isToday ? 'bg-m3-primary text-white w-[16px] h-[16px] md:w-[22px] md:h-[22px] rounded-full flex items-center justify-center' : 'text-gray-700'}
                  `}>
                    {format(day, 'd')}
                  </span>
                </div>

                {isInMonth && stats && (
                  <div className="flex flex-col items-end justify-end flex-grow w-full overflow-hidden">
                    {stats.income > 0 && (
                      <span className="text-[8px] sm:text-[9.5px] md:text-[10px] font-semibold text-m3-primary mb-[0.5px] tabular-nums tracking-tight whitespace-nowrap overflow-hidden text-ellipsis w-full text-right block">
                        <span className="inline sm:hidden">+{formatCalendarCompact(stats.income)}</span>
                        <span className="hidden sm:inline">+{formatCurrency(stats.income)}</span>
                      </span>
                    )}
                    {stats.expense > 0 && (
                      <span className="text-[8px] sm:text-[9.5px] md:text-[10px] font-semibold text-rose-600 dark:text-rose-400 mb-[0.5px] tabular-nums tracking-tight whitespace-nowrap overflow-hidden text-ellipsis w-full text-right block">
                        <span className="inline sm:hidden">-{formatCalendarCompact(stats.expense)}</span>
                        <span className="hidden sm:inline">-{formatCurrency(stats.expense)}</span>
                      </span>
                    )}
                    <span className={`text-[8.5px] sm:text-[10px] md:text-[11px] font-bold mt-0.5 tabular-nums tracking-tight whitespace-nowrap overflow-hidden text-ellipsis w-full text-right block ${stats.balance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'} ${isToday ? 'bg-m3-secondary-container/50 px-0.5 rounded-sm' : ''}`}>
                      <span className="inline sm:hidden">{formatCalendarCompact(stats.balance)}</span>
                      <span className="hidden sm:inline">{formatCurrency(stats.balance)}</span>
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen w-full bg-m3-surface font-sans text-slate-800 overflow-hidden antialiased">
      {/* Mobile Glass Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-slate-50/85 backdrop-blur-md border-b border-slate-200/40 py-1.5 px-4 h-11 flex justify-between items-center">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <h1 
            className="text-sm font-black text-slate-900 tracking-tight select-none cursor-pointer hover:text-m3-primary transition-colors truncate"
            onClick={handleTitleClick}
          >
            {t('Balance Calendar')}
          </h1>
          <p className="text-[8.5px] text-slate-400 font-bold shrink-0">{t('Finance Simulation')}</p>
        </div>
        <button 
          onClick={() => setIsHelpModalOpen(true)}
          className="p-1.5 text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-full transition-all active:scale-95 shrink-0"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Mobile Material 3 Bottom Navigation Dock */}
      <div className="lg:hidden fixed bottom-3 left-3 right-3 z-40 pointer-events-none flex justify-center">
        <div className="bg-m3-surface/95 backdrop-blur-md w-full max-w-sm rounded-full border border-m3-surface-container-high shadow-xs border-m3-outline-variant p-1 flex items-center justify-around pointer-events-auto">
          <button 
            type="button"
            onClick={() => {
              if (activeTab === 'calendar') handleTitleClick();
              else setActiveTab('calendar');
            }}
            className="flex flex-col items-center justify-center flex-1 py-0.5 transition-all"
          >
            <div className={`flex items-center justify-center px-4 py-1.5 rounded-full duration-200 ${activeTab === 'calendar' ? 'bg-m3-secondary-container text-m3-on-secondary-container' : 'text-slate-500 hover:text-slate-800'}`}>
              <CalendarIcon className="w-4.5 h-4.5 shrink-0" />
            </div>
            <span className="text-[8.5px] font-black mt-0.5 text-slate-600">달력</span>
          </button>
          
          <button 
            type="button"
            onClick={() => setActiveTab('recurring')}
            className="flex flex-col items-center justify-center flex-1 py-0.5 transition-all"
          >
            <div className={`flex items-center justify-center px-4 py-1.5 rounded-full duration-200 ${activeTab === 'recurring' ? 'bg-m3-secondary-container text-m3-on-secondary-container' : 'text-slate-500 hover:text-slate-800'}`}>
              <Repeat className="w-4.5 h-4.5 shrink-0" />
            </div>
            <span className="text-[8.5px] font-black mt-0.5 text-slate-600">고정지출</span>
          </button>

          <button 
            type="button"
            onClick={() => setActiveTab('settings')}
            className="flex flex-col items-center justify-center flex-1 py-0.5 transition-all"
          >
            <div className={`flex items-center justify-center px-4 py-1.5 rounded-full duration-200 ${activeTab === 'settings' ? 'bg-m3-secondary-container text-m3-on-secondary-container' : 'text-slate-500 hover:text-slate-800'}`}>
              <Settings className="w-4.5 h-4.5 shrink-0" />
            </div>
            <span className="text-[8.5px] font-black mt-0.5 text-slate-600">설정</span>
          </button>

          {(() => {
             const finalBalance = simulationData[format(endOfMonth(months[months.length - 1]), 'yyyy-MM-dd')]?.balance ?? initialBalance;
             const isNegative = finalBalance < 0;
             return deathValleyInfo ? (
               <button 
                 type="button"
                 onClick={() => setIsDeathValleyModalOpen(true)}
                 className="flex flex-col items-center justify-center flex-1 py-0.5 transition-all"
               >
                 <div className={`flex items-center justify-center px-4 py-1.5 rounded-full duration-200 ${isNegative ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                   <TrendingDown className="w-4.5 h-4.5 shrink-0" />
                 </div>
                 <span className="text-[8.5px] font-black mt-0.5 text-slate-600">{isNegative ? '추경필요' : '건전대원'}</span>
               </button>
             ) : null;
           })()}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        {/* Floating Desktop Sidebar */}
        <aside 
          className={`
            w-full lg:w-[350px] bg-m3-surface lg:m-4 lg:border border-slate-200/80 lg:border border-m3-surface-container-high shadow-xs lg:rounded-3xl flex-col p-6 pt-24 lg:pt-6 shrink-0 h-full overflow-hidden
            ${(activeTab === 'settings' || activeTab === 'recurring') ? 'flex overflow-y-auto pb-32 lg:pb-6' : 'hidden lg:flex overflow-hidden'}
          `}
        >
          {/* Sidebar Desktop branding */}
          <div className="hidden lg:flex items-center justify-between mb-6">
            <div className="flex flex-col">
              <h1 
                className="text-base font-black tracking-tight mb-0.5 select-none hover:text-m3-primary transition-colors cursor-pointer"
                onClick={handleTitleClick}
              >
                {t('Balance Calendar')}
              </h1>
              <p className="text-[10px] text-slate-400 font-bold">{t('Finance Simulation')}</p>
            </div>
            <button 
              className="lg:hidden p-2 text-slate-400 hover:text-slate-600"
              onClick={() => setActiveTab('calendar')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-6 flex-grow overflow-y-auto pr-1 no-scrollbar flex flex-col justify-between">
            <div>
              {/* Segmented Control with Capsule design - 3 Tabs for PC */}
              <div className="hidden lg:grid grid-cols-3 gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-2xl mb-6 text-xs font-bold select-none border border-slate-200/60 dark:border-slate-700/60">
                <button 
                  onClick={() => { setSidebarTab('detail'); setActiveTab('calendar'); }}
                  className={`py-2 px-1 rounded-xl transition-all text-center cursor-pointer text-[11px] ${sidebarTab === 'detail' ? 'bg-m3-surface shadow-xs text-m3-primary font-black border border-slate-200/50 dark:border-slate-700' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
                >
                  기본 내역
                </button>
                <button 
                  onClick={() => { setSidebarTab('recurring'); setActiveTab('recurring'); }}
                  className={`py-2 px-1 rounded-xl transition-all text-center cursor-pointer text-[11px] ${sidebarTab === 'recurring' ? 'bg-m3-surface shadow-xs text-m3-primary font-black border border-slate-200/50 dark:border-slate-700' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
                >
                  고정 지출
                </button>
                <button 
                  onClick={() => { setSidebarTab('settings'); setActiveTab('settings'); }}
                  className={`py-2 px-1 rounded-xl transition-all text-center cursor-pointer text-[11px] ${sidebarTab === 'settings' ? 'bg-m3-surface shadow-xs text-m3-primary font-black border border-slate-200/50 dark:border-slate-700' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
                >
                  설정
                </button>
              </div>

              {sidebarTab === 'detail' ? (
                <div className="space-y-5">

                  <section>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">{t('기초 자산 설정')}</label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={new Intl.NumberFormat('ko-KR').format(initialBalance)}
                        onChange={handleInitialBalanceChange}
                        className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-m3-surface rounded-3xl px-4 py-3 text-lg font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-m3-primary/15 transition-all tabular-nums tracking-tight"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold text-xs">{isComradeMode ? '억 원' : '₩'}</span>
                    </div>
                  </section>

                  <section className="bg-slate-50/50 border border-slate-200/60 rounded-3xl p-4 space-y-4 shadow-3xs">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-bold">{t('총 수입 (예정)')}</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        +<span className="tabular-nums tracking-tight">{formatCurrency(transactions.filter(t => t.isActive && t.type === 'income').reduce((s,tx) => s+tx.amount, 0))}</span>
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-bold">{t('총 지출 (예정)')}</span>
                      <span className="font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                        -<span className="tabular-nums tracking-tight">{formatCurrency(transactions.filter(t => t.isActive && t.type === 'expense').reduce((s,tx) => s+tx.amount, 0))}</span>
                      </span>
                    </div>
                    <div className="h-px bg-slate-200/60 my-1"></div>
                    <div className="flex justify-between items-end">
                      <span className="text-xs font-bold leading-none text-slate-700 flex items-center gap-1">
                        {t('기말 잔액')}
                        <button 
                          onClick={() => setIsHelpModalOpen(true)}
                          className="text-slate-400 tabular-nums tracking-tight hover:text-m3-primary transition-colors p-0.5"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                        </button>
                      </span>
                      <span className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-none tabular-nums">
                        <span className="tabular-nums tracking-tight">{formatCurrency(simulationData[format(endOfMonth(months[months.length - 1]), 'yyyy-MM-dd')]?.balance ?? initialBalance)}</span>
                      </span>
                    </div>
                  </section>

                  <div className="hidden lg:block">
                    {selectedDate && (
                      <section className="mt-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 block">
                          {format(selectedDate, 'M월 d일', { locale: ko })} 내역
                        </label>
                        <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-0.5 no-scrollbar">
                          {getTransactionsForDate(selectedDate, transactions, recurringTransactions, recurringExceptions).map(tx => (
                            <div 
                              key={tx.id} 
                              onDoubleClick={() => openForm(selectedDate, tx)}
                              className={`flex items-center justify-between p-3.5 rounded-3xl transition-all select-none cursor-pointer border border-slate-200 hover:border-m3-primary/40 ${tx.isActive ? 'bg-m3-surface shadow-3xs' : 'bg-slate-100/40 border-dashed opacity-45'}`}
                            >
                              <div className="flex flex-col min-w-0 pr-2">
                                <span className={`text-[12px] font-extrabold text-slate-800 truncate flex items-center gap-1.5 ${!tx.isActive ? 'line-through text-slate-400' : ''}`}>
                                  {tx.id.startsWith('dynamic-') && <span className="text-m3-primary font-bold shrink-0 text-[10px]" title="고정 지출/수입 항목">🔁</span>}
                                  {tx.memo || (tx.type === 'income' ? t('수입') : t('지출'))}
                                </span>
                                <span className={`text-[11px] font-bold mt-0.5 tabular-nums ${tx.type === 'income' ? 'text-m3-primary' : 'text-rose-600 dark:text-rose-400'}`}>
                                  {(tx.type === 'income' ? '+' : '-') + formatCurrency(tx.amount)}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button 
                                  onClick={(e) => { e.stopPropagation(); toggleTransaction(tx.id); }} 
                                  className={`w-9 h-5 rounded-full flex items-center px-0.5 transition-all outline-none focus:ring-1 focus:ring-m3-primary/15 ${tx.isActive ? 'bg-m3-primary justify-end' : 'bg-slate-200 justify-start'}`}
                                >
                                  <div className="w-4 h-4 bg-m3-surface rounded-full shadow-3xs" />
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); openForm(selectedDate, tx); }} 
                                  className="p-1 text-slate-400 hover:text-m3-primary transition-colors"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); deleteTransaction(tx.id); }} 
                                  className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                          {getTransactionsForDate(selectedDate, transactions, recurringTransactions, recurringExceptions).length === 0 && (
                            <div className="text-center py-8 text-xs text-slate-400 italic bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
                              내역이 없습니다.
                            </div>
                          )}
                        </div>
                      </section>
                    )}
                  </div>
                </div>
              ) : sidebarTab === 'recurring' ? (
                <div className="space-y-6">
                  {/* 고정 지출/수입 요약 분석 카드 */}
                  <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white rounded-3xl p-5 shadow-sm space-y-4 relative overflow-hidden">
                    <div className="absolute right-[-10px] top-[-10px] opacity-10">
                      <Repeat className="w-24 h-24 text-white rotate-12" />
                    </div>
                    <div>
                      <h4 className="text-[10px] font-black text-indigo-200 uppercase tracking-widest flex items-center gap-1.5">
                        <Wallet className="w-3.5 h-3.5 text-indigo-300" /> {t('월간 고정 흐름 분석')}
                      </h4>
                      <p className="text-[11px] text-slate-300/80 mt-1 leading-relaxed">
                        {t('등록된 모든 고정 규칙의 한 달 기준 환산 요약입니다.')}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-700/50">
                      <div className="space-y-0.5">
                        <span className="text-[9.5px] font-bold text-slate-400 block">{t('고정 수입 (월)')}</span>
                        <div className="flex items-center gap-1 text-emerald-400 font-bold text-sm tabular-nums tracking-tight">
                          <ArrowUpCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>+{formatCurrency(recurringOverview.income)}</span>
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[9.5px] font-bold text-slate-400 block">{t('고정 지출 (월)')}</span>
                        <div className="flex items-center gap-1 text-rose-400 font-bold text-sm tabular-nums tracking-tight">
                          <ArrowDownCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>-{formatCurrency(recurringOverview.expense)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white/5 rounded-2xl p-3 flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-200">{t('순 고정 자금 (월)')}</span>
                      <span className={`text-sm font-bold tabular-nums tracking-tight ${recurringOverview.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {recurringOverview.net >= 0 ? '+' : ''}{formatCurrency(recurringOverview.net)}
                      </span>
                    </div>
                  </div>

                  {/* 고정 지출/수입 등록 및 수정 양식 */}
                  <section className={`border rounded-3xl p-4 space-y-4 shadow-3xs transition-all ${
                    editingRecRuleId ? 'bg-m3-secondary-container/20 border-m3-primary/40 ring-1 ring-m3-primary/20' : 'bg-slate-50/70 border-slate-200'
                  }`}>
                    <div className="flex justify-between items-center">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                        <Repeat className="w-3.5 h-3.5 text-m3-primary" /> {editingRecRuleId ? t('고정 내역 수정중') : t('고정 내역 추가')}
                      </h3>
                      {editingRecRuleId ? (
                        <button
                          type="button"
                          onClick={cancelEditRecurringRule}
                          className="text-[10px] font-black text-rose-500 hover:text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200 cursor-pointer"
                        >
                          {t('취소')}
                        </button>
                      ) : (
                        <span className="text-[10px] text-m3-primary font-bold bg-m3-primary-container/40 px-2 py-0.5 rounded-full">
                          {t('시뮬레이터 반영')}
                        </span>
                      )}
                    </div>
                    
                    {/* 수입 / 지출 탭 토글 */}
                    <div className="grid grid-cols-2 gap-1 bg-slate-200/50 p-1 rounded-full text-xs font-bold select-none border border-slate-200/10">
                      <button 
                        type="button"
                        onClick={() => setRecType('income')}
                        className={`py-1.5 rounded-full transition-colors text-center cursor-pointer ${recType === 'income' ? 'bg-m3-primary text-white shadow-xs font-black' : 'text-slate-500 hover:text-slate-800'}`}
                      >
                        {t('수입')}
                      </button>
                      <button 
                        type="button"
                        onClick={() => setRecType('expense')}
                        className={`py-1.5 rounded-full transition-colors text-center cursor-pointer ${recType === 'expense' ? 'bg-rose-600 text-white shadow-xs font-black' : 'text-slate-500 hover:text-slate-800'}`}
                      >
                        {t('지출')}
                      </button>
                    </div>

                    {/* 추천 템플릿 (원클릭 레이아웃) */}
                    <div className="space-y-1.5">
                      <label className="text-[9.5px] text-slate-400 font-bold uppercase tracking-wide block">{t('추천 고정 항목 (원클릭 입력)')}</label>
                      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-slate-200">
                        {(isComradeMode
                          ? (recType === 'income'
                            ? [
                                { memo: '민생회복지원금', type: 'income', amount: 25, frequency: 'monthly', icon: '🧧' },
                                { memo: '중국동포지원금', type: 'income', amount: 30, frequency: 'monthly', icon: '🇨🇳' },
                                { memo: '고유가지원금', type: 'income', amount: 15, frequency: 'monthly', icon: '⛽' },
                                { memo: '지하 혁명 지원금', type: 'income', amount: 50, frequency: 'monthly', icon: '🌾' }
                              ]
                            : [
                                { memo: '당비 납부 (상납)', type: 'expense', amount: 10, frequency: 'monthly', icon: '🚩' },
                                { memo: '배급소 식수 분담금', type: 'expense', amount: 5, frequency: 'monthly', icon: '🚰' },
                                { memo: '공화국 국방 헌금', type: 'expense', amount: 20, frequency: 'monthly', icon: '🚀' },
                                { memo: '러시아 용병 지원금', type: 'expense', amount: 35, frequency: 'monthly', icon: '🇷🇺' }
                              ]
                            )
                          : (recType === 'income' 
                            ? [
                                { memo: '급여 (월급)', type: 'income', amount: 3500000, frequency: 'monthly', icon: '💼' },
                                { memo: '아르바이트', type: 'income', amount: 950000, frequency: 'monthly', icon: '⚡' },
                                { memo: '정기 용돈', type: 'income', amount: 300000, frequency: 'monthly', icon: '🧸' },
                                { memo: '투자 배당금', type: 'income', amount: 150000, frequency: 'monthly', icon: '📈' }
                              ]
                            : [
                                { memo: '유튜브 프리미엄', type: 'expense', amount: 14900, frequency: 'monthly', icon: '📺' },
                                { memo: '넷플릭스', type: 'expense', amount: 17000, frequency: 'monthly', icon: '🎬' },
                                { memo: '월세 납부', type: 'expense', amount: 550000, frequency: 'monthly', icon: '🏠' },
                                { memo: '통신 요금', type: 'expense', amount: 69000, frequency: 'monthly', icon: '📱' },
                                { memo: '헬스장/피트니스', type: 'expense', amount: 50000, frequency: 'monthly', icon: '🏋️' },
                                { memo: '실비 보험료', type: 'expense', amount: 45000, frequency: 'monthly', icon: '🛡️' }
                              ]
                            )
                        ).map((preset) => (
                          <button
                            key={preset.memo}
                            type="button"
                            onClick={() => applyPreset({
                              memo: preset.memo,
                              type: preset.type as TransactionType,
                              amount: preset.amount,
                              frequency: preset.frequency as FrequencyType
                            })}
                            className="bg-m3-surface hover:bg-m3-secondary-container hover:text-m3-on-secondary-container text-slate-700 hover:border-m3-primary/30 border border-slate-200/80 rounded-full px-2.5 py-1 text-[10.5px] font-black transition-all flex items-center gap-1 shadow-3xs hover:scale-95 shrink-0 whitespace-nowrap cursor-pointer"
                          >
                            <span>{preset.icon}</span>
                            <span>{preset.memo}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9.5px] text-slate-400 font-bold uppercase tracking-wide block">금액</label>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          value={recAmount}
                          onChange={(e) => {
                            const numericValue = e.target.value.replace(/[^0-9]/g, '');
                            setRecAmount(numericValue ? Number(numericValue).toLocaleString('ko-KR') : '');
                          }}
                          className="w-full bg-m3-surface border border-slate-200 rounded-3xl px-3 py-2 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-m3-primary/20 focus:border-m3-primary tabular-nums"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] font-black">{isComradeMode ? '억 원' : '₩'}</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9.5px] text-slate-400 font-bold uppercase tracking-wide block">내용 (메모)</label>
                      <input
                        type="text"
                        placeholder={recType === 'income' ? '수입 사연 기입' : '지출 사연 기입'}
                        value={recMemo}
                        onChange={(e) => setRecMemo(e.target.value)}
                        className="w-full bg-m3-surface border border-slate-200 rounded-3xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-m3-primary/20 focus:border-m3-primary"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9.5px] text-slate-400 font-bold uppercase tracking-wide block">시작일</label>
                        <input
                          type="date"
                          value={recStartDate}
                          onChange={(e) => setRecStartDate(e.target.value)}
                          className="w-full bg-m3-surface border border-slate-200 rounded-3xl px-2 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-m3-primary/20 text-slate-700"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9.5px] text-slate-400 font-bold uppercase tracking-wide block">{t('종료일 (옵션)')}</label>
                        <input
                          type="date"
                          value={recEndDate}
                          onChange={(e) => setRecEndDate(e.target.value)}
                          className="w-full bg-m3-surface border border-slate-200 rounded-3xl px-2 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-m3-primary/20 text-slate-700"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9.5px] text-slate-400 font-bold uppercase tracking-wide block">{t('발생 주기')}</label>
                      <select
                        value={recFrequency}
                        onChange={(e) => setRecFrequency(e.target.value as FrequencyType)}
                        className="w-full bg-m3-surface border border-slate-200 rounded-3xl px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-m3-primary/20"
                      >
                        <option value="daily">{t('매일')}</option>
                        <option value="weekly">{t('매주')}</option>
                        <option value="monthly">{t('매달')}</option>
                        <option value="custom">{t('직접 입력')}</option>
                      </select>
                    </div>

                    {recFrequency === 'custom' && (
                      <div className="space-y-1">
                        <label className="text-[9.5px] text-slate-400 font-bold uppercase tracking-wide block">{t('발생 간격 (일 단위)')}</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            value={recCustomInterval}
                            onChange={(e) => setRecCustomInterval(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-16 bg-m3-surface border border-slate-200 rounded-3xl px-2 py-1.5 text-xs font-black text-center focus:outline-none focus:ring-1 focus:ring-m3-primary/20"
                          />
                          <span className="text-xs font-bold text-slate-500">{t('일 마다 발생')}</span>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={addRecurringRule}
                        className="flex-1 py-2.5 bg-m3-primary text-white rounded-full text-xs font-extrabold hover:bg-m3-primary/90 transition-colors active:scale-95 shadow-3xs cursor-pointer"
                      >
                        {editingRecRuleId ? t('고정 규칙 수정 완료') : t('고정 규칙 생성하기')}
                      </button>
                      {editingRecRuleId && (
                        <button
                          type="button"
                          onClick={cancelEditRecurringRule}
                          className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full text-xs font-bold transition-colors cursor-pointer"
                        >
                          {t('취소')}
                        </button>
                      )}
                    </div>
                  </section>

                  {/* 활성 고정 규칙 관리 목록 & 세그먼트 필터 */}
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        등록 목록 ({recurringTransactions.length}개)
                      </label>
                      
                      {/* 카드 필터 버튼 */}
                      <div className="flex bg-slate-100 p-0.5 rounded-full border border-slate-200/50 text-[9.5px] font-bold select-none">
                        {(['all', 'income', 'expense'] as const).map((filter) => {
                          const count = filter === 'all' 
                            ? recurringTransactions.length 
                            : recurringTransactions.filter(r => r.type === filter).length;
                          return (
                            <button
                              key={filter}
                              type="button"
                              onClick={() => setRecFilter(filter)}
                              className={`px-2 py-0.5 rounded-full transition-all cursor-pointer font-black ${recFilter === filter ? 'bg-white shadow-3xs text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                              {filter === 'all' ? '전체' : filter === 'income' ? '수입' : '지출'} ({count})
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-0.5 no-scrollbar">
                      {recurringTransactions
                        .filter(rule => recFilter === 'all' || rule.type === recFilter)
                        .map(rule => {
                          const isInc = rule.type === 'income';
                          const isEditingThis = editingRecRuleId === rule.id;
                          return (
                            <div 
                              key={rule.id} 
                              onClick={() => startEditRecurringRule(rule)}
                              className={`p-3.5 bg-m3-surface border rounded-3xl flex items-center justify-between hover:shadow-2xs transition-all cursor-pointer ${
                                isEditingThis ? 'ring-2 ring-m3-primary border-m3-primary shadow-xs' : ''
                              } ${
                                isInc 
                                  ? 'border-emerald-100 bg-gradient-to-br from-m3-surface to-emerald-50/10' 
                                  : 'border-rose-100 bg-gradient-to-br from-m3-surface to-rose-50/10'
                              }`}
                            >
                              <div className="min-w-0 pr-2">
                                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                                  <span className={`text-[9px] font-black px-2 py-0.5 rounded-md ${
                                    isInc 
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                                      : 'bg-rose-50 text-rose-700 border border-rose-100'
                                  }`}>
                                    {isInc ? '수입' : '지출'}
                                  </span>
                                  <span className="text-xs font-extrabold text-slate-800 truncate block max-w-[120px]" title={rule.memo}>
                                    {rule.memo}
                                  </span>
                                  <span className="text-[9.5px] font-bold text-m3-primary bg-m3-secondary-container px-2 py-0.5 rounded-full">
                                    {getFrequencyLabel(rule)}
                                  </span>
                                </div>
                                <div className="text-[10px] font-bold text-slate-400/80 flex flex-col space-y-0.5">
                                  <span className="flex items-center gap-1">
                                    <CalendarIcon className="w-3 h-3 text-slate-400 shrink-0" />
                                    <span>기간: {rule.startDate} {rule.endDate ? `~ ${rule.endDate}` : '(무기한)'}</span>
                                  </span>
                                </div>
                                <div className={`text-[12px] font-bold mt-2 tracking-tight tabular-nums ${isInc ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                  <span className="tabular-nums tracking-tight">
                                    {isInc ? '+' : '-'}{formatCurrency(rule.amount)}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEditRecurringRule(rule);
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-m3-primary hover:bg-m3-secondary-container rounded-full transition-colors shrink-0 cursor-pointer"
                                  title="규칙 수정"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteRecurringRule(rule.id);
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors shrink-0 cursor-pointer"
                                  title="규칙 삭제"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}

                      {recurringTransactions.filter(rule => recFilter === 'all' || rule.type === recFilter).length === 0 && (
                        <div className="text-center py-10 text-xs text-slate-400 font-medium italic bg-slate-50/50 rounded-3xl border border-dashed border-slate-200 px-4">
                          조건에 부합하는 고정 규칙이 없습니다.
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              ) : (
                /* Settings Tab */
                <div className="space-y-5">
                  {/* Theme Mode Selection */}
                  <section className="bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 rounded-3xl p-4 space-y-3 shadow-3xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                        {t('테마 설정')}
                      </span>
                      <span className="text-[10px] text-m3-primary font-bold">
                        {themeMode === 'system' ? '시스템 설정' : themeMode === 'dark' ? '다크모드' : '라이트모드'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 bg-slate-200/60 dark:bg-slate-900/60 p-1 rounded-2xl text-xs font-bold select-none border border-slate-200/40 dark:border-slate-700/40">
                      <button
                        type="button"
                        onClick={() => setThemeMode('light')}
                        className={`py-2 px-1 rounded-xl transition-all text-center cursor-pointer flex flex-col items-center gap-1 ${
                          themeMode === 'light'
                            ? 'bg-m3-surface shadow-xs text-m3-primary font-black border border-slate-200/50 dark:border-slate-700'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        <Sun className="w-4 h-4 shrink-0 text-amber-500" />
                        <span className="text-[10px]">라이트</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setThemeMode('dark')}
                        className={`py-2 px-1 rounded-xl transition-all text-center cursor-pointer flex flex-col items-center gap-1 ${
                          themeMode === 'dark'
                            ? 'bg-m3-surface shadow-xs text-m3-primary font-black border border-slate-200/50 dark:border-slate-700'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        <Moon className="w-4 h-4 shrink-0 text-indigo-400" />
                        <span className="text-[10px]">다크</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setThemeMode('system')}
                        className={`py-2 px-1 rounded-xl transition-all text-center cursor-pointer flex flex-col items-center gap-1 ${
                          themeMode === 'system'
                            ? 'bg-m3-surface shadow-xs text-m3-primary font-black border border-slate-200/50 dark:border-slate-700'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        <Monitor className="w-4 h-4 shrink-0 text-slate-400" />
                        <span className="text-[10px]">시스템</span>
                      </button>
                    </div>
                  </section>

                  {/* Cloud Sync Section */}
                  <section className="bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 rounded-3xl p-4 space-y-3 shadow-3xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                        클라우드 동기화
                      </span>
                      {supabaseUser && (
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${isCloudSyncing ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
                          <span className="text-[9.5px] font-bold text-slate-400">
                            {isCloudSyncing ? '동기화 중...' : '동기화됨'}
                          </span>
                        </div>
                      )}
                    </div>
                    {!supabaseUser ? (
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={handleGoogleLogin}
                          disabled={!getSupabase()}
                          className="w-full py-3 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-100 rounded-2xl font-black text-xs transition-all active:scale-95 border border-slate-200 dark:border-slate-600 shadow-3xs flex items-center justify-center gap-2 cursor-pointer duration-200"
                        >
                          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                            <path
                              fill="#4285F4"
                              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            />
                            <path
                              fill="#34A853"
                              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                            />
                            <path
                              fill="#EA4335"
                              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                            />
                          </svg>
                          <span>Google 로그인</span>
                        </button>
                        {!getSupabase() && (
                          <p className="text-[9.5px] text-amber-600 font-bold leading-normal text-center break-keep">
                            ⚠️ Supabase 환경 변수가 아직 설정되지 않았습니다. AI Studio의 Settings에서 Secrets을 설정해 주세요.
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="bg-white/85 dark:bg-slate-700/80 border border-slate-100 dark:border-slate-600 p-3 rounded-2xl flex items-center justify-between">
                          <div className="flex flex-col min-w-0 select-none">
                            <span className="text-[10px] font-extrabold text-slate-400">연결된 계정</span>
                            <span className="text-[11.5px] font-black text-slate-800 dark:text-slate-100 truncate select-all">{supabaseUser.email}</span>
                          </div>
                          <button
                            type="button"
                            onClick={handleSignOut}
                            className="p-2 bg-slate-100 dark:bg-slate-600 hover:bg-slate-200 dark:hover:bg-slate-500 text-slate-500 dark:text-slate-200 rounded-xl transition-colors duration-200 cursor-pointer flex items-center justify-center shrink-0"
                            title="로그아웃"
                          >
                            <LogOut className="w-4 h-4" />
                          </button>
                        </div>
                        {cloudSyncError && (
                          <div className="space-y-3">
                            <div className="p-3.5 bg-red-50/80 dark:bg-red-950/50 border border-red-100/70 dark:border-red-900/70 text-rose-600 dark:text-rose-400 rounded-2xl">
                              <p className="text-[10px] font-bold leading-normal whitespace-pre-wrap break-keep">
                                {cloudSyncError}
                              </p>
                            </div>
                            
                            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 rounded-2xl p-3.5 space-y-2.5 shadow-3xs transition-all">
                              <button
                                type="button"
                                onClick={() => setIsSqlHelpOpen(!isSqlHelpOpen)}
                                className="w-full flex items-center justify-between text-left text-xs font-black text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white cursor-pointer select-none"
                              >
                                <span className="flex items-center gap-1.5">🛠️ Supabase 테이블 및 RLS 설정 가이드</span>
                                {isSqlHelpOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                              </button>
                              
                              {isSqlHelpOpen && (
                                <div className="space-y-3 text-[10.5px] text-slate-600 dark:text-slate-300 leading-normal border-t border-slate-200/50 dark:border-slate-700/50 pt-2.5 animate-fade-in">
                                  <p className="font-extrabold text-slate-700 dark:text-slate-200">간단한 2단계 지침으로 동기화 문제를 즉시 해결할 수 있습니다:</p>
                                  
                                  <div className="space-y-1 bg-white dark:bg-slate-900 p-2.5 border border-slate-100 dark:border-slate-800 rounded-xl shadow-4xs">
                                    <p className="font-black text-slate-700 dark:text-slate-200">1단계. Supabase SQL Editor 열기</p>
                                    <p className="font-medium text-slate-500 dark:text-slate-400 text-[10px]">
                                      본인의 Supabase 프로젝트 대시보드의 왼쪽 메뉴에서 <strong className="text-slate-800 dark:text-slate-200">SQL Editor</strong>를 클릭하고, 상단의 <strong className="text-slate-800 dark:text-slate-200">New Query</strong>를 눌러 새로운 SQL 쿼리 생성창을 엽니다.
                                    </p>
                                  </div>

                                  <div className="space-y-2.5 bg-white dark:bg-slate-900 p-2.5 border border-slate-100 dark:border-slate-800 rounded-xl shadow-4xs">
                                    <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 px-2 py-1.5 rounded-lg border border-slate-200/30 dark:border-slate-700/30">
                                      <p className="font-black text-slate-700 dark:text-slate-200">2단계. 아래 쿼리 복사 & 실행</p>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const sqlCode = `CREATE TABLE IF NOT EXISTS public.user_sync (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    initial_balance_enc TEXT,
    transactions_enc TEXT,
    recurring_transactions_enc TEXT,
    recurring_exceptions_enc TEXT,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.user_sync ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow select for owner" ON public.user_sync;
DROP POLICY IF EXISTS "Allow insert/update for owner" ON public.user_sync;
DROP POLICY IF EXISTS "Allow all for owner" ON public.user_sync;

CREATE POLICY "Allow all for owner" ON public.user_sync
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);`;
                                          navigator.clipboard.writeText(sqlCode);
                                          setCopiedSql(true);
                                          setTimeout(() => setCopiedSql(false), 2000);
                                        }}
                                        className="flex items-center gap-1 px-2 py-0.5 bg-m3-primary hover:bg-m3-primary/95 text-white rounded-md font-bold text-[9.5px] transition-all cursor-pointer shadow-3xs"
                                      >
                                        {copiedSql ? (
                                          <>
                                            <Check className="w-2.5 h-2.5" />
                                            <span>복사완료!</span>
                                          </>
                                        ) : (
                                          <>
                                            <Copy className="w-2.5 h-2.5" />
                                            <span>SQL 복사</span>
                                          </>
                                        )}
                                      </button>
                                    </div>
                                    
                                    <pre className="p-2 bg-slate-900 text-slate-200 rounded-lg text-[8.5px] font-mono overflow-x-auto max-h-40 leading-relaxed select-all no-scrollbar">
{`CREATE TABLE IF NOT EXISTS public.user_sync (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    initial_balance_enc TEXT,
    transactions_enc TEXT,
    recurring_transactions_enc TEXT,
    recurring_exceptions_enc TEXT,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.user_sync ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow select for owner" ON public.user_sync;
DROP POLICY IF EXISTS "Allow insert/update for owner" ON public.user_sync;
DROP POLICY IF EXISTS "Allow all for owner" ON public.user_sync;

CREATE POLICY "Allow all for owner" ON public.user_sync
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);`}
                                    </pre>
                                    <p className="text-slate-500 dark:text-slate-400 font-medium text-[10px] break-keep leading-tight">
                                      위 코드를 복사하여 SQL Editor에 붙여넣은 뒤, 우측 하단의 <strong className="text-slate-800 dark:text-slate-200">Run</strong> 버튼을 눌러 성공적으로 실행해 주세요.
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>

                  {/* Backup & Restore */}
                  <section className="bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 rounded-3xl p-4 space-y-3 shadow-3xs">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                      {t('데이터 백업 및 복원')}
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        type="button"
                        onClick={() => openDataSyncModal('export')}
                        className="py-2.5 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-2xl font-black text-[11px] transition-all shadow-3xs active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer border border-slate-200 dark:border-slate-600"
                      >
                        <Upload size={13} /> {t('내보내기')}
                      </button>
                      <button 
                        type="button"
                        onClick={() => openDataSyncModal('import')}
                        className="py-2.5 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-2xl font-black text-[11px] transition-all shadow-3xs active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer border border-slate-200 dark:border-slate-600"
                      >
                        <Download size={13} /> {t('불러오기')}
                      </button>
                    </div>
                  </section>

                  {/* Language & Mode */}
                  <section className="bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 rounded-3xl p-4 space-y-3 shadow-3xs">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                      {t('언어 및 표시 설정')}
                    </span>
                    <div className="flex items-center justify-between gap-2">
                      <button 
                        type="button"
                        onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}
                        className="flex-1 py-2 px-3 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 transition-colors text-center"
                      >
                        🌐 {lang === 'ko' ? '한국어 (KR)' : 'English (EN)'}
                      </button>
                      <button 
                        type="button"
                        onClick={() => setIsComradeMode(!isComradeMode)}
                        className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs transition-colors flex items-center justify-center gap-1.5 ${isComradeMode ? 'bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 border border-slate-200 dark:border-slate-600'}`}
                      >
                        🚩 {isComradeMode ? '인민 달력' : '일반 달력'}
                      </button>
                    </div>
                  </section>

                  {/* Reset Data */}
                  <section className="bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 rounded-3xl p-4 space-y-3 shadow-3xs">
                    <span className="text-[10px] font-bold text-rose-500 uppercase tracking-widest block">
                      {t('초기화')}
                    </span>
                    <button 
                      type="button"
                      onClick={() => {
                        setKeepInitialBalance(false);
                        setKeepFutureRecurringRules(false);
                        setKeepPastRecurringRecords(false);
                        setKeepTodayAndFutureRecords(false);
                        setIsResetOptionsExpanded(false);
                        setIsResetModalOpen(true);
                      }}
                      className="w-full py-3 bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 rounded-2xl font-black text-xs transition-colors active:scale-95 border border-rose-200 dark:border-rose-900 shadow-3xs cursor-pointer"
                    >
                      {t('데이터 초기화')}
                    </button>
                  </section>
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className={`flex-1 overflow-y-auto px-4 pt-13 pb-20 lg:p-8 flex-col items-center bg-m3-surface relative ${activeTab === 'calendar' ? 'flex' : 'hidden lg:flex'}`}>
          {/* Main Desktop Header */}
          <div className="hidden lg:flex items-center justify-between w-full max-w-5xl mb-6">
            <div className="flex flex-col">
              <h1 className="text-xl font-bold tracking-tight select-none cursor-pointer hover:text-m3-primary transition-colors" onClick={handleTitleClick}>
              {t('Balance Calendar')}
              </h1>
              <p className="text-[10px] text-gray-500">{t('Finance Simulation')}</p>
            </div>
            
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setIsHelpModalOpen(true)}
                className="text-gray-400 tabular-nums tracking-tight hover:text-m3-primary transition-colors p-1.5"
              >
                <HelpCircle className="w-5 h-5" />
              </button>
              {(() => {
                const finalBalance = simulationData[format(endOfMonth(months[months.length - 1]), 'yyyy-MM-dd')]?.balance ?? initialBalance;
                const isNegative = finalBalance < 0;
                return deathValleyInfo ? (
                  <button 
                    onClick={() => setIsDeathValleyModalOpen(true)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-colors active:scale-95 border border-m3-surface-container-high shadow-xs border ${
                      isNegative 
                        ? 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100' 
                        : 'bg-green-50 text-green-600 border-green-100 hover:bg-green-100'
                    }`}
                  >
                    <TrendingDown className="w-4 h-4" /> {isNegative ? '추경 필요' : '건전재정'}
                  </button>
                ) : null;
              })()}
            </div>
          </div>
          
          <div className="w-full max-w-5xl flex flex-col gap-8 pb-8">
            <button 
              onClick={loadPreviousMonth}
              className="w-full py-3 border-2 border-dashed border-m3-outline-variant text-gray-400 font-bold rounded-full hover:bg-m3-surface hover:text-m3-primary hover:border-m3-primary/30 transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" /> {t('이전 달력 추가')}
            </button>

            {months.map(month => renderCalendar(month))}

            <button 
              onClick={loadNextMonth}
              className="w-full py-3 border-2 border-dashed border-m3-outline-variant text-gray-400 font-bold rounded-full hover:bg-m3-surface hover:text-m3-primary hover:border-m3-primary/30 transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" /> {t('다음 달력 추가')}
            </button>
          </div>
        </main>
      </div>

      {/* Mobile Transaction List Bottom Sheet */}
      <AnimatePresence>
        {isBottomSheetOpen && selectedDate && (
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40 flex items-end lg:hidden justify-center"
            onClick={() => setIsBottomSheetOpen(false)}
          >
            <motion.div 
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ ease: [0.2, 0, 0, 1], duration: 0.4 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={0.2}
              onDragEnd={(e, info) => {
                if (info.offset.y > 100) {
                  setIsBottomSheetOpen(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#F9FAFB] w-full rounded-t-[28px] border border-m3-surface-container-high shadow-xs border border-m3-outline-variant flex flex-col max-h-[85vh] absolute bottom-0"
            >
              <div 
                className="w-full pt-4 pb-3 flex justify-center items-center cursor-ns-resize touch-none"
              >
                <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
              </div>
              <div className="px-6 pb-4 border-b border-m3-outline-variant shrink-0">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-lg font-bold">
                    {format(selectedDate, 'M월 d일', { locale: ko })}
                  </h3>
                  <button 
                    onClick={() => setIsBottomSheetOpen(false)}
                    className="p-2 text-gray-400 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                {(() => {
                  const dayTransactions = getTransactionsForDate(selectedDate, transactions, recurringTransactions, recurringExceptions).filter(tx => tx.isActive);
                  const income = dayTransactions.filter(tx => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0);
                  const expense = dayTransactions.filter(tx => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0);
                  const total = income - expense;
                  return (
                    <div className="text-[13px] font-medium text-gray-600 flex items-center gap-1.5 flex-wrap">
                      <span className="text-m3-primary tabular-nums tracking-tight font-bold">+<span className="tabular-nums tracking-tight">{formatCurrency(income)}</span></span>
                      <span className="text-gray-400 tabular-nums tracking-tight">-</span>
                      <span className="text-m3-error tabular-nums tracking-tight font-bold"><span className="tabular-nums tracking-tight">{formatCurrency(expense)}</span></span>
                      <span className="text-gray-400 tabular-nums tracking-tight">=</span>
                      <span className={`font-bold ${total >= 0 ? 'text-m3-primary' : 'text-m3-error'}`}>
                        {total > 0 ? '+' : ''}<span className="tabular-nums tracking-tight">{formatCurrency(total)}</span>
                      </span>
                    </div>
                  );
                })()}
              </div>

              <div className="flex-1 overflow-y-auto px-0 py-0 overscroll-contain bg-m3-surface pb-6">
                <div className="divide-y divide-gray-100 border-b border-m3-surface-container-high">
                {getTransactionsForDate(selectedDate, transactions, recurringTransactions, recurringExceptions).map(tx => (
                  <div key={tx.id} className="relative bg-m3-surface-container overflow-hidden">
                    <div className="absolute inset-y-0 right-0 flex items-stretch">
                      <button 
                        onClick={() => deleteTransaction(tx.id)}
                        className="px-5 bg-m3-error text-white flex items-center justify-center font-bold text-xs"
                      >
                        {t('삭제')}
                      </button>
                    </div>
                    <motion.div 
                      drag="x"
                      dragConstraints={{ left: -70, right: 0 }}
                      dragElastic={0.1}
                      onClick={() => { setIsBottomSheetOpen(false); openForm(selectedDate, tx); }}
                      className={`relative flex items-center justify-between p-4 px-6 transition-colors select-none ${tx.isActive ? 'bg-m3-surface' : 'bg-gray-100'}`}
                    >
                      <div className={`flex flex-col min-w-0 pr-2 ${!tx.isActive ? 'opacity-40' : ''}`}>
                        <span className={`text-[13px] font-semibold truncate flex items-center gap-1.5 ${!tx.isActive ? 'line-through' : ''}`}>
                          {tx.id.startsWith('dynamic-') && <span className="text-blue-500 font-bold shrink-0 text-[11px]" title="고정 지출/수입 항목">🔁</span>}
                          {tx.memo || (tx.type === 'income' ? t('수입') : t('지출'))}
                        </span>
                        <span className={`text-[12px] mt-0.5 font-bold tabular-nums tracking-tight ${tx.type === 'income' ? 'text-m3-primary' : 'text-m3-error'}`}>
                          {(tx.type === 'income' ? '+' : '-') + formatCurrency(tx.amount)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 pr-2">
                        <button 
                          onClick={(e) => { e.stopPropagation(); toggleTransaction(tx.id); }} 
                          onPointerDownCapture={e => e.stopPropagation()}
                          className={`w-10 h-5.5 rounded-full flex items-center px-0.5 transition-all ${tx.isActive ? 'bg-m3-primary justify-end' : 'bg-gray-300 justify-start'}`}
                        >
                          <div className="w-4.5 h-4.5 bg-m3-surface rounded-full border border-m3-surface-container-high shadow-xs" />
                        </button>
                      </div>
                    </motion.div>
                  </div>
                ))}
                {getTransactionsForDate(selectedDate, transactions, recurringTransactions, recurringExceptions).length === 0 && (
                  <div className="text-center py-10 text-sm text-gray-400">
                    등록된 내역이 없습니다.
                  </div>
                )}
                </div>
              </div>

              <div className="p-6 border-t border-m3-outline-variant shrink-0 bg-m3-surface pb-[calc(1.5rem+env(safe-area-inset-bottom))] flex gap-3">
                <button 
                  onClick={() => {
                    setIsBottomSheetOpen(false);
                    openForm(selectedDate, undefined, 'income');
                  }}
                  className="flex-1 py-3.5 bg-m3-primary-container text-m3-primary rounded-3xl font-bold text-sm hover:bg-m3-primary/20 transition-colors border border-m3-surface-container-high shadow-xs border border-m3-primary/20 active:scale-95 flex justify-center items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> {t('수입 기록')}
                </button>
                <button 
                  onClick={() => {
                    setIsBottomSheetOpen(false);
                    openForm(selectedDate, undefined, 'expense');
                  }}
                  className="flex-1 py-3.5 bg-m3-error-container text-m3-error rounded-3xl font-bold text-sm hover:bg-m3-error/20 transition-colors border border-m3-surface-container-high shadow-xs border border-m3-error/20 active:scale-95 flex justify-center items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> {t('지출 기록')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Transaction Entry Modal - Bottom Sheet on mobile */}
      <AnimatePresence>
        {isFormOpen && (
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end lg:items-center justify-center"
            onClick={() => setIsFormOpen(false)}
          >
            <motion.div 
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ ease: [0.2, 0, 0, 1], duration: 0.4 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-m3-surface w-full max-w-lg lg:max-w-sm rounded-t-[28px] lg:rounded-3xl border border-m3-surface-container-high shadow-xs border border-m3-outline-variant p-6 lg:p-6 border-t lg:border border-m3-surface-container-high pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:pb-6"
            >
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 lg:hidden" />
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold">
                  {format(formDate, 'M월 d일', { locale: ko })} {editingId ? t('내역 수정') : t('내역 추가')}
                </h3>
                <button 
                  onClick={() => setIsFormOpen(false)}
                  className="lg:hidden p-2 text-gray-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{t('날짜')}</label>
                  <input 
                    type="date"
                    value={format(formDate, 'yyyy-MM-dd')}
                    onChange={(e) => {
                      if (e.target.value) {
                        setFormDate(parseISO(e.target.value));
                      }
                    }}
                    className="w-full bg-m3-surface-container border border-m3-outline-variant rounded-xl py-2.5 px-4 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-m3-primary/30 transition-all text-gray-800"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">구분</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setFormType('income')}
                      className={`py-2.5 rounded-xl font-semibold text-sm transition-all border ${formType === 'income' ? 'bg-m3-primary-container border-m3-primary text-m3-primary' : 'bg-m3-surface-container border-m3-surface-container-high text-gray-500'}`}
                    >
                      {t('수입')}
                    </button>
                    <button 
                      onClick={() => setFormType('expense')}
                      className={`py-2.5 rounded-xl font-semibold text-sm transition-all border ${formType === 'expense' ? 'bg-m3-error-container border-m3-error text-m3-error' : 'bg-m3-surface-container border-m3-surface-container-high text-gray-500'}`}
                    >
                      {t('지출')}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{t('금액')}</label>
                  <div className="relative">
                    <input 
                      ref={amountInputRef}
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formAmount}
                      onChange={handleAmountChange}
                      className="w-full bg-m3-surface-container border border-m3-outline-variant rounded-xl py-3 px-4 text-base font-bold focus:outline-none focus:ring-2 focus:ring-m3-primary/30 transition-all"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 font-bold">{isComradeMode ? '억 원' : '₩'}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{t('내용 (선택)')}</label>
                  <input 
                    type="text"
                    placeholder="내용 입력..."
                    value={formMemo}
                    onChange={(e) => setFormMemo(e.target.value)}
                    className="w-full bg-m3-surface-container border border-m3-outline-variant rounded-xl py-3 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-m3-primary/30 transition-all"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button 
                    onClick={() => setIsFormOpen(false)}
                    className="flex-1 py-3 text-gray-500 text-sm font-semibold hover:bg-m3-surface-container rounded-full transition-all"
                  >
                    {t('취소')}
                  </button>
                  <button 
                    id="save-btn"
                    onClick={addTransaction}
                    className="flex-[2] py-3 bg-m3-primary text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-all border border-m3-surface-container-high shadow-xs"
                  >
                    {t('저장하기')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Conflict Resolution Modal */}
      <AnimatePresence>
        {isConflictModalOpen && (
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end lg:items-center justify-center p-0 lg:p-4"
          >
            <motion.div 
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ ease: [0.2, 0, 0, 1], duration: 0.4 }}
              className="bg-m3-surface w-full max-w-md rounded-t-[28px] lg:rounded-3xl border border-m3-surface-container-high shadow-xs border border-m3-outline-variant p-6 border-t lg:border border-m3-surface-container-high pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:pb-6 font-sans text-slate-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-5 lg:hidden" />
              
              <div className="text-center mb-6">
                <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <AlertTriangle className="w-6 h-6 text-amber-500" />
                </div>
                <h3 className="text-lg font-extrabold text-[#1d192b] mb-1.5 leading-snug">
                  동기화 데이터 충돌 감지
                </h3>
                <p className="text-xs text-gray-500 leading-relaxed max-w-sm mx-auto font-medium break-keep">
                  기존 클라우드 데이터를 가져오시겠습니까? 아니면 현재 기기의 데이터로 클라우드를 덮어쓰시겠습니까?
                  두 곳 모두 기존 저장 내역이 감지되어 덮어쓰기 전 조심스럽게 확인을 구합니다.
                </p>
              </div>

              <div className="space-y-2.5">
                <button 
                  type="button"
                  onClick={handleOverwriteLocalWithCloud}
                  className="w-full py-3 px-4 bg-m3-primary text-white rounded-3xl font-extrabold text-xs hover:bg-m3-primary/95 transition-all shadow-xs active:scale-95 cursor-pointer duration-200 block text-center"
                >
                  기존 클라우드 데이터 불러오기
                </button>
                <button 
                  type="button"
                  onClick={handleOverwriteCloudWithLocal}
                  className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-3xl font-extrabold text-xs transition-all active:scale-95 border border-slate-200 shadow-3xs cursor-pointer duration-200 block text-center"
                >
                  현재 기기의 데이터로 클라우드 덮어쓰기 (현재 데이터로 동기화)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reset Confirmation Modal */}
      <AnimatePresence>
        {isResetModalOpen && (
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end lg:items-center justify-center p-0 lg:p-4"
            onClick={() => setIsResetModalOpen(false)}
          >
            <motion.div 
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ ease: [0.2, 0, 0, 1], duration: 0.4 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-m3-surface w-full max-w-md rounded-t-[28px] lg:rounded-3xl border border-m3-surface-container-high shadow-xs border border-m3-outline-variant p-6 border-t lg:border border-m3-surface-container-high pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:pb-6"
            >
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-5 lg:hidden" />
              
              <div className="text-center mb-5">
                <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <AlertTriangle className="w-6 h-6 text-m3-error" />
                </div>
                <h3 className="text-lg font-extrabold text-[#1d192b] mb-1.5">
                  {isComradeMode ? '자료 혁명 단행' : '모든 데이터를 초기화하시겠습니까?'}
                </h3>
                <p className="text-xs text-gray-400 leading-relaxed max-w-sm mx-auto font-medium">
                  {isComradeMode 
                    ? '배급 기록이 제거되며, 혁명은 돌이킬 수 없소. 아래 옵션으로 보존 대상을 가릴 수 있소.' 
                    : '초기화 실행 시 복구가 불가능합니다. 아래 옵션을 활성화하여 원하는 데이터만 선택적으로 보존할 수 있습니다.'}
                </p>
              </div>

              {/* Accordion - Reset Options Setting */}
              <div className="mb-6">
                <button
                  type="button"
                  onClick={() => setIsResetOptionsExpanded(!isResetOptionsExpanded)}
                  className="w-full flex items-center justify-between py-2.5 px-4 bg-m3-surface-container hover:bg-gray-100 active:bg-gray-200/70 rounded-3xl text-xs font-bold text-gray-750 transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    ⚙️ {t('초기화 옵션 설정')}
                  </span>
                  {isResetOptionsExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  )}
                </button>

                <motion.div
                  initial={false}
                  animate={{ height: isResetOptionsExpanded ? "auto" : 0, opacity: isResetOptionsExpanded ? 1 : 0 }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="mt-2.5 p-3.5 bg-m3-surface-container/50 rounded-3xl border border-m3-surface-container-high space-y-3 text-left">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-gray-800">기초 자산 유지</span>
                        <span className="text-[10px] text-gray-400 leading-normal">현재 설정된 기초 자산 값을 0으로 리셋하지 않고 보존합니다.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setKeepInitialBalance(!keepInitialBalance)}
                        className={`w-11 h-6 rounded-full transition-colors relative duration-200 shrink-0 focus:outline-none ${keepInitialBalance ? 'bg-green-600' : 'bg-gray-200'}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 bg-m3-surface w-5 h-5 rounded-full border border-m3-surface-container-high shadow-xs transition-transform duration-200 ${keepInitialBalance ? 'translate-x-5' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>

                    <div className="h-px bg-gray-100" />

                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-gray-800">미래 고정 규칙 유지</span>
                        <span className="text-[10px] text-gray-400 leading-normal">앞으로 자동 발생할 지출/수입 고정 규칙을 지우지 않습니다.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setKeepFutureRecurringRules(!keepFutureRecurringRules)}
                        className={`w-11 h-6 rounded-full transition-colors relative duration-200 shrink-0 focus:outline-none ${keepFutureRecurringRules ? 'bg-green-600' : 'bg-gray-200'}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 bg-m3-surface w-5 h-5 rounded-full border border-m3-surface-container-high shadow-xs transition-transform duration-200 ${keepFutureRecurringRules ? 'translate-x-5' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>

                    <div className="h-px bg-gray-100" />

                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-gray-800">과거 고정 내역 유지</span>
                        <span className="text-[10px] text-gray-400 leading-normal">이미 달력 상에 확정 생성된 고정 발생 가계 내역들을 보존합니다.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setKeepPastRecurringRecords(!keepPastRecurringRecords)}
                        className={`w-11 h-6 rounded-full transition-colors relative duration-200 shrink-0 focus:outline-none ${keepPastRecurringRecords ? 'bg-green-600' : 'bg-gray-200'}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 bg-m3-surface w-5 h-5 rounded-full border border-m3-surface-container-high shadow-xs transition-transform duration-200 ${keepPastRecurringRecords ? 'translate-x-5' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>

                    <div className="h-px bg-gray-100" />

                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-xs font-bold text-gray-800">{t('내일 이후 내역 보존')}</span>
                        <span className="text-[10px] text-gray-400 leading-normal break-keep">{t('오늘 포함 과거 내역을 모두 지우고, 내일 이후의 내역만 남겨둡니다.')}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setKeepTodayAndFutureRecords(!keepTodayAndFutureRecords)}
                        className={`w-11 h-6 rounded-full transition-colors relative duration-200 shrink-0 focus:outline-none ${keepTodayAndFutureRecords ? 'bg-green-600' : 'bg-gray-200'}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 bg-m3-surface w-5 h-5 rounded-full border border-m3-surface-container-high shadow-xs transition-transform duration-200 ${keepTodayAndFutureRecords ? 'translate-x-5' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2.5">
                <button 
                  type="button"
                  onClick={() => setIsResetModalOpen(false)}
                  className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 active:bg-gray-250 text-gray-600 text-xs font-bold rounded-full transition-all"
                >
                  {t('취소')}
                </button>
                <button 
                  type="button"
                  onClick={handleReset}
                  className="flex-[1.5] py-3 bg-m3-error text-white rounded-3xl text-xs font-bold hover:bg-red-650 active:scale-95 transition-all border border-m3-surface-container-high shadow-xs shadow-red-100"
                >
                  {isComradeMode ? '혁명수행' : '초기화 실행'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Death Valley Modal */}
      <AnimatePresence>
        {isDeathValleyModalOpen && (
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
            onClick={() => setIsDeathValleyModalOpen(false)}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ ease: [0.2, 0, 0, 1], duration: 0.4 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-m3-surface w-full max-w-sm rounded-3xl border border-m3-surface-container-high shadow-xs border border-m3-outline-variant p-6 border border-m3-surface-container-high"
            >
              <div className="flex justify-between items-center mb-5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center text-orange-600">
                    <TrendingDown className="w-4 h-4" />
                  </div>
                  <h3 className="text-lg font-bold text-[#1d192b]">{t('재정 건전도 예측')}</h3>
                </div>
                <button 
                  onClick={() => setIsDeathValleyModalOpen(false)}
                  className="p-2 text-gray-400 bg-m3-surface-container hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {deathValleyInfo ? (
                <div className="space-y-4">
                  <div className="p-4 bg-orange-50/50 border border-orange-100 rounded-3xl">
                    <p className="text-xs text-orange-800 font-medium mb-1">{t('예상 최저 잔액 발생일')}</p>
                    <p className="text-lg font-bold text-orange-600 flex justify-between items-end">
                      <span>
                        {isComradeMode 
                          ? `주체 ${deathValleyInfo.date.getFullYear() - 1911}(${deathValleyInfo.date.getFullYear()})년 ${deathValleyInfo.date.getMonth() + 1}월 ${deathValleyInfo.date.getDate()}일`
                          : format(deathValleyInfo.date, 'yyyy년 M월 d일', { locale: ko })
                        }
                      </span>
                      <span className={`text-[15px] font-bold tabular-nums tracking-tight ${deathValleyInfo.balance < 0 ? 'text-m3-error' : 'text-slate-900 dark:text-slate-100'}`}>
                        <span className="tabular-nums tracking-tight">{formatCurrency(deathValleyInfo.balance)}</span>
                      </span>
                    </p>
                  </div>
                  
                  <div className="h-48 w-full -ml-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={deathValleyChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? "#1e2a40" : "#E5E7EB"} />
                        <XAxis 
                          dataKey="dateLabel" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 10, fill: isDarkMode ? "#94a3b8" : "#6B7280" }} 
                          dy={10}
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 10, fill: isDarkMode ? "#94a3b8" : "#6B7280" }}
                          tickFormatter={(value) => value === 0 ? '0' : `${(value / 10000).toLocaleString()}만`}
                          width={45}
                        />
                        <Tooltip 
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              return (
                                <div className="bg-m3-surface border border-m3-surface-container-high shadow-xs border border-m3-outline-variant p-2 rounded-xl text-xs">
                                  <p className="text-gray-500 mb-1">{payload[0].payload.date}</p>
                                  <p className={`font-bold ${payload[0].value !== undefined && Number(payload[0].value) < 0 ? 'text-m3-error' : 'text-m3-primary'}`}>
                                    <span className="tabular-nums tracking-tight">{formatCurrency(Number(payload[0].value))}</span>
                                  </p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <ReferenceLine y={0} stroke="#FF3B30" strokeDasharray="3 3" opacity={0.5} />
                        <Line 
                          type="monotone" 
                          dataKey="balance" 
                          stroke="#007AFF" 
                          strokeWidth={2.5}
                          dot={{ r: 2, fill: '#007AFF' }}
                          activeDot={{ r: 5, fill: '#007AFF', stroke: 'white', strokeWidth: 2 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <p className="text-xs text-gray-500 leading-relaxed pt-2">
                    시뮬레이션 기간 동안 잔고가 가장 낮은 지점입니다. 잔고가 마이너스로 내려가지 않도록 유동성을 관리하세요.
                  </p>
                </div>
              ) : (
                <div className="py-8 text-center text-gray-400 text-sm">
                  데이터가 없어 예측할 수 없습니다.
                </div>
              )}

              <div className="mt-6 pt-4 border-t border-m3-surface-container-high">
                <button 
                  onClick={() => setIsDeathValleyModalOpen(false)}
                  className="w-full py-3 bg-gray-900 text-white rounded-3xl font-bold text-sm hover:bg-gray-800 transition-colors active:scale-95"
                >
                  확인
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Data Sync Modal */}
      <AnimatePresence>
        {isDataSyncModalOpen && (
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end lg:items-center justify-center"
            onClick={() => setIsDataSyncModalOpen(false)}
          >
            <motion.div 
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ ease: [0.2, 0, 0, 1], duration: 0.4 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-m3-surface w-full max-w-lg lg:max-w-md rounded-t-[28px] lg:rounded-3xl border border-m3-surface-container-high shadow-xs border border-m3-outline-variant p-6 lg:p-6 border-t lg:border border-m3-surface-container-high flex flex-col max-h-[80vh] pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:pb-6"
            >
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 lg:hidden shrink-0" />
              <div className="flex justify-between items-center mb-4 shrink-0">
                <h3 className="text-lg font-bold">
                  {dataSyncMode === 'export' ? t('데이터 내보내기') : t('데이터 불러오기')}
                </h3>
                <button 
                  onClick={() => setIsDataSyncModalOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-full"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto min-h-0 mb-6">
                <p className="text-sm text-gray-500 mb-4 break-keep">
                  {dataSyncMode === 'export' 
                    ? t('아래 텍스트를 복사하여 다른 기기나 브라우저에서 사용할 수 있습니다.')
                    : t('내보내기한 텍스트를 아래에 붙여넣어주세요.')}
                </p>
                <textarea
                  value={syncText}
                  onChange={(e) => setSyncText(e.target.value)}
                  readOnly={dataSyncMode === 'export'}
                  className="w-full h-48 bg-m3-surface-container border border-m3-outline-variant rounded-xl p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-m3-primary/30 resize-none font-mono break-all"
                  placeholder={dataSyncMode === 'import' ? t('이곳에 텍스트를 붙여넣으세요...') : ''}
                />
                <AnimatePresence>
                  {syncError && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="text-red-500 text-sm mt-2 font-medium">
                      {syncError}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex gap-3 shrink-0">
                <button 
                  onClick={() => setIsDataSyncModalOpen(false)}
                  className="flex-1 py-3 text-gray-500 text-sm font-semibold hover:bg-m3-surface-container rounded-full border border-m3-outline-variant transition-all"
                >
                  {t('취소')}
                </button>
                {dataSyncMode === 'export' ? (
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(syncText).then(() => {
                        alert(t('텍스트가 복사되었습니다!'));
                      }).catch(() => {
                        alert(t('복사에 실패했습니다. 직접 선택하여 복사해주세요.'));
                      });
                    }}
                    className="flex-[2] py-3 bg-m3-primary text-white rounded-3xl font-semibold text-sm hover:bg-blue-700 transition-all border border-m3-surface-container-high shadow-xs"
                  >
                    {t('텍스트 복사하기')}
                  </button>
                ) : (
                  <button 
                    onClick={handleImport}
                    className="flex-[2] py-3 bg-m3-primary text-white rounded-3xl font-semibold text-sm hover:bg-blue-700 transition-all border border-m3-surface-container-high shadow-xs"
                  >
                    {t('데이터 적용하기')}
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Help Modal */}
      <AnimatePresence>
        {isHelpModalOpen && (
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end lg:items-center justify-center"
            onClick={() => setIsHelpModalOpen(false)}
          >
            <motion.div 
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ ease: [0.2, 0, 0, 1], duration: 0.4 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-m3-surface w-full max-w-lg lg:max-w-sm rounded-t-[28px] lg:rounded-3xl border border-m3-surface-container-high shadow-xs border border-m3-outline-variant p-6 border-t lg:border border-m3-surface-container-high pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:pb-6"
            >
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 lg:hidden" />
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-m3-primary" /> {t('앱 사용 가이드')}
                </h3>
                <button onClick={() => setIsHelpModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 rounded-full bg-m3-surface-container hover:bg-gray-100">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-sm text-gray-600">
                <div className="p-3.5 bg-blue-50/50 rounded-3xl border border-blue-100/50 leading-relaxed">
                  <strong className="block text-[#1d192b] mb-1"><span className="mr-1">📅</span>{t('내역 관리하기')}</strong>
                  {isComradeMode ? '달력 일자를 가볍게 치거나 두 번 쳐서 기입하고, 아래 명찰 목록을 다시 눌러 간편하게 수정 및 삭제하시오.' : '달력 날짜를 가볍게 선택하거나 더블 탭하여 간편하게 등록하고, 날짜 선택 후 아래 나타나는 항목을 터치해 즉시 수정/삭제하세요.'}
                </div>
                <div className="p-3.5 bg-blue-50/50 rounded-3xl border border-blue-100/50 leading-relaxed">
                  <strong className="block text-[#1d192b] mb-1"><span className="mr-1">🔁</span>{t('고정 항목 자동 반영')}</strong>
                  {isComradeMode ? '매달 기여하는 계획 재정이나 반복 세금 등은 고정지출 탭에 한 번만 등록하여 국가적 수령금으로 자동 반영시키시오.' : '매월 반복되는 급여, 적금, 생활비 등은 고정지출 탭에 한 번 등록해 두면 자동으로 기말 잔액 흐름을 예측하고 채워 줍니다.'}
                </div>
                <div className="p-3.5 bg-blue-50/50 rounded-3xl border border-blue-100/50 leading-relaxed">
                  <strong className="block text-[#1d192b] mb-1"><span className="mr-1">☁️</span>{t('실시간 계정 연동')}</strong>
                  {isComradeMode ? '설정 탭에서 Google로 로그인하여 동기화를 개시하면, 공화국 안전 클라우드에 귀하의 기밀 정보가 실시간 대기 대조 보존되오.' : '설정 탭에서 Google 계정으로 로그인해 실시간 데이터 동기화를 켜 주시면, 기기를 바꾸거나 재시작해도 소중한 자산 계획을 안전하게 이어 복구할 수 있습니다.'}
                </div>
              </div>
              
              <button 
                onClick={() => setIsHelpModalOpen(false)}
                className="w-full mt-6 py-3.5 bg-m3-primary text-white rounded-3xl font-semibold hover:bg-blue-700 transition-colors active:scale-95"
              >
                {t('확인했어요!')}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Easter Egg */}
      {showEasterEgg && (
        <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden flex items-center justify-center">
          {[...Array(50)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute text-5xl will-change-transform"
              initial={{ 
                top: -100, 
                left: `${Math.random() * 100}%`,
                x: 0,
              }}
              animate={{ 
                top: '120%', 
                x: (Math.random() - 0.5) * 300,
                rotate: Math.random() * 360 * 3
              }}
              transition={{ 
                duration: Math.random() * 1.5 + 1.5,
                ease: 'linear'
              }}
            >
              {isComradeMode ? ['🛢️', '🇰🇵'][Math.floor(Math.random() * 2)] : ['💸', '💰', '💵', '🪙', '🇰🇷'][Math.floor(Math.random() * 5)]}
            </motion.div>
          ))}
          <motion.div 
            initial={{ opacity: 0, scale: 0.5, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`text-white px-8 py-5 rounded-3xl font-black text-2xl tracking-widest backdrop-blur-md shadow-2xl flex items-center gap-3 ${isComradeMode ? 'bg-red-800/90' : 'bg-black/80'}`}
          >
            {isComradeMode ? '🎉 배급 사회 시작 🎉' : '🎉 자본주의 복귀 🎉'}
          </motion.div>
        </div>
      )}
    </div>
  );
}
