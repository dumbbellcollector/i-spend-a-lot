export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: string;
  date: string; // ISO string
  type: TransactionType;
  amount: number;
  memo: string;
  isActive: boolean;
  recurringId?: string; // ID of the recurring transaction series (if archived)
  isRecurring?: boolean; // Flag to identify recurring transactions
}

export type FrequencyType = 'daily' | 'weekly' | 'monthly' | 'custom';

export interface RecurringTransaction {
  id: string;
  type: TransactionType;
  amount: number;
  memo: string;
  startDate: string; // yyyy-MM-dd
  endDate?: string; // yyyy-MM-dd, optional
  frequency: FrequencyType;
  customInterval?: number; // every X days
}

export interface RecurringException {
  recurringId: string;
  date: string; // yyyy-MM-dd
  isActive?: boolean;  // false if toggled off
  isDeleted?: boolean; // true if completely deleted from that day
}
