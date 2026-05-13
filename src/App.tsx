/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
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
  Upload
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

type TransactionType = 'income' | 'expense';

interface Transaction {
  id: string;
  date: string; // ISO string
  type: TransactionType;
  amount: number;
  memo: string;
  isActive: boolean;
}

// --- Utils ---

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(amount);
};

// --- Components ---

export default function App() {
  const [initialBalance, setInitialBalance] = useState<number>(() => {
    const saved = localStorage.getItem('cashFlow_initialBalance');
    return saved ? Number(saved) : 1000000;
  });
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem('cashFlow_transactions');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('cashFlow_initialBalance', initialBalance.toString());
  }, [initialBalance]);

  useEffect(() => {
    localStorage.setItem('cashFlow_transactions', JSON.stringify(transactions));
  }, [transactions]);

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDataSyncModalOpen, setIsDataSyncModalOpen] = useState(false);
  const [dataSyncMode, setDataSyncMode] = useState<'export' | 'import'>('export');
  const [syncText, setSyncText] = useState('');
  const [syncError, setSyncError] = useState('');

  // Form State
  const [formType, setFormType] = useState<TransactionType>('expense');
  const [formAmount, setFormAmount] = useState<string>('');
  const [formMemo, setFormMemo] = useState<string>('');
  const [formDate, setFormDate] = useState<Date>(new Date());

  const [months, setMonths] = useState<Date[]>(() => {
    const now = new Date();
    return [startOfMonth(now), startOfMonth(addMonths(now, 1))];
  });

  const loadPreviousMonth = () => {
    setMonths(prev => [startOfMonth(addMonths(prev[0], -1)), ...prev]);
  };
  
  const loadNextMonth = () => {
    setMonths(prev => [...prev, startOfMonth(addMonths(prev[prev.length - 1], 1))]);
  };

  useEffect(() => {
    if (!isFormOpen) return;
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
    return () => window.removeEventListener('keydown', handleKeyDown);
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
    setTransactions([]);
    setInitialBalance(1000000);
    const now = new Date();
    setMonths([startOfMonth(now), startOfMonth(addMonths(now, 1))]);
    setIsResetModalOpen(false);
  };

  const openDataSyncModal = (mode: 'export' | 'import') => {
    setDataSyncMode(mode);
    setSyncError('');
    if (mode === 'export') {
      const data = { initialBalance, transactions };
      const encoded = btoa(encodeURIComponent(JSON.stringify(data)));
      setSyncText(encoded);
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
    try {
      const decoded = decodeURIComponent(atob(syncText));
      const data = JSON.parse(decoded);
      if (typeof data.initialBalance === 'number' && Array.isArray(data.transactions)) {
        setInitialBalance(data.initialBalance);
        setTransactions(data.transactions);
        setIsDataSyncModalOpen(false);
      } else {
        setSyncError('잘못된 데이터 형식입니다.');
      }
    } catch (e) {
      setSyncError('유효하지 않은 데이터입니다.');
    }
  };

  const openForm = (date: Date, transaction?: Transaction) => {
    if (transaction) {
      setEditingId(transaction.id);
      setFormType(transaction.type);
      setFormAmount(new Intl.NumberFormat('ko-KR').format(transaction.amount));
      setFormMemo(transaction.memo);
      setFormDate(parseISO(transaction.date));
    } else {
      setEditingId(null);
      setFormType('expense');
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
      setTransactions(transactions.map(t => 
        t.id === editingId ? { ...t, type: formType, amount: rawAmount, memo: formMemo } : t
      ));
    } else {
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
    setTransactions(transactions.filter(t => t.id !== id));
  };

  const toggleTransaction = (id: string) => {
    setTransactions(transactions.map(t => 
      t.id === id ? { ...t, isActive: !t.isActive } : t
    ));
  };

  // Calculate daily balances
  const simulationData = useMemo(() => {
    const startDate = startOfMonth(months[0]);
    const endDate = endOfMonth(months[months.length - 1]);
    const dayInterval = eachDayOfInterval({ start: startDate, end: endDate });

    const dailyStats: Record<string, { income: number; expense: number; balance: number }> = {};
    let cumulativeBalance = initialBalance;

    dayInterval.forEach(day => {
      const dateKey = format(day, 'yyyy-MM-dd');
      const dayTransactions = transactions.filter(t => 
        isSameDay(parseISO(t.date), day) && t.isActive
      );

      const income = dayTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);
      
      const expense = dayTransactions
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
  }, [transactions, initialBalance, months]);

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
          <h2 className="text-lg font-bold">{format(month, 'yyyy년 M월', { locale: ko })}</h2>
          {months.length > 1 && (
            <button 
              onClick={() => removeMonth(month)}
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
              title="달력 삭제"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        
        <div className="bg-[#E5E7EB] border border-[#E5E7EB] grid grid-cols-7 gap-[1px] rounded-lg overflow-hidden flex-1 shadow-sm mx-auto w-full">
          {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
            <div key={day} className="bg-white py-1.5 md:py-2 text-center text-[9px] md:text-[10px] font-bold text-gray-400 border-b border-gray-100">
              {day}
            </div>
          ))}

          {days.map((day) => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const stats = simulationData[dateKey];
            const isSelected = isSameDay(day, selectedDate);
            const isToday = isSameDay(day, new Date());
            const isInMonth = isSameMonth(day, month);
            const dayTransactions = transactions.filter(t => isSameDay(parseISO(t.date), day));

            return (
              <div
                key={dateKey}
                onClick={() => setSelectedDate(day)}
                onDoubleClick={() => openForm(day)}
                className={`
                  bg-white min-h-[70px] md:min-h-[85px] p-1.5 md:p-2 flex flex-col justify-between cursor-pointer transition-all
                  ${!isInMonth ? 'opacity-30 pointer-events-none' : 'hover:bg-gray-50 flex'}
                  ${isSelected && isInMonth ? 'ring-2 ring-inset ring-[#007AFF]/30 bg-blue-50/20' : ''}
                `}
              >
                <div className="flex justify-between items-start mb-0.5">
                  <span className={`
                    text-[11px] md:text-[13px] font-semibold
                    ${isToday ? 'bg-[#007AFF] text-white w-[18px] h-[18px] md:w-[22px] md:h-[22px] rounded-full flex items-center justify-center' : 'text-gray-700'}
                  `}>
                    {format(day, 'd')}
                  </span>
                </div>

                {isInMonth && (
                  <div className="flex flex-col items-end flex-grow">
                    <div className="flex flex-col items-end w-full space-y-0.5 overflow-hidden mb-0.5">
                      {dayTransactions.slice(0, 3).map(t => (
                        <span key={t.id} className={`text-[8px] md:text-[9.5px] font-medium block truncate max-w-full 
                          ${!t.isActive ? 'text-gray-400 line-through' : (t.type === 'income' ? 'text-[#007AFF]' : 'text-[#FF3B30]')}
                        `}>
                          {t.type === 'income' ? '+' : '-'}{t.amount.toLocaleString()}
                        </span>
                      ))}
                      {dayTransactions.length > 3 && (
                        <span className="text-[7px] text-gray-400">···</span>
                      )}
                    </div>
                    {stats && (
                      <span className="text-[#8E8E93] text-[8px] md:text-[9.5px] font-medium text-right mt-auto border-t border-gray-100 pt-0.5 w-full">
                        {stats.balance.toLocaleString()}
                      </span>
                    )}
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
    <div className="flex flex-col lg:flex-row h-screen w-full bg-[#F8F9FA] overflow-hidden">
      {/* Mobile Top Header */}
      <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-[#E5E7EB] shrink-0 safe-top-padding">
        <div className="flex items-center gap-2">
          <Menu 
            className="w-6 h-6 text-gray-600 cursor-pointer" 
            onClick={() => setIsSidebarOpen(true)} 
          />
          <h1 className="text-base font-bold tracking-tight">현금 흐름</h1>
        </div>
        <div className="text-sm font-bold text-[#007AFF]">
          {(simulationData[format(endOfMonth(months[months.length - 1]), 'yyyy-MM-dd')]?.balance ?? initialBalance).toLocaleString()}₩
        </div>
      </header>

      {/* Sidebar - Drawer on mobile, sidebar on desktop */}
      <aside 
        className={`
          fixed inset-y-0 left-0 z-40 w-72 bg-white border-r border-[#E5E7EB] flex flex-col p-6 
          transition-transform duration-300 ease-in-out
          lg:relative lg:translate-x-0 lg:z-0 lg:flex
          ${isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-bold tracking-tight mb-1">현금 흐름</h1>
            <p className="text-xs text-gray-500">Cash Flow Simulation</p>
          </div>
          <button 
            className="lg:hidden p-2 text-gray-400 hover:text-gray-600"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="space-y-6 flex-grow overflow-y-auto pr-1">
          <section>
            <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 block">기초 자산 설정</label>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                value={new Intl.NumberFormat('ko-KR').format(initialBalance)}
                onChange={handleInitialBalanceChange}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-lg font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
              <span className="absolute right-3 top-3.5 text-gray-400 font-bold">₩</span>
            </div>
          </section>

          <section className="bg-white border border-[#E5E7EB] rounded-xl p-4 space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600">총 수입 (예정)</span>
              <span className="font-semibold text-[#007AFF]">
                +{transactions.filter(t => t.isActive && t.type === 'income').reduce((s,t) => s+t.amount, 0).toLocaleString()}₩
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600">총 지출 (예정)</span>
              <span className="font-semibold text-[#FF3B30]">
                -{transactions.filter(t => t.isActive && t.type === 'expense').reduce((s,t) => s+t.amount, 0).toLocaleString()}₩
              </span>
            </div>
            <div className="h-px bg-gray-100 my-2"></div>
            <div className="flex justify-between items-end">
              <span className="text-sm font-medium">기말 잔액</span>
              <span className="text-xl font-bold text-[#1C1C1E]">
                {(simulationData[format(endOfMonth(months[months.length - 1]), 'yyyy-MM-dd')]?.balance ?? initialBalance).toLocaleString()}₩
              </span>
            </div>
          </section>

          {selectedDate && (
            <section>
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3 block">
                {format(selectedDate, 'M월 d일', { locale: ko })} 내역
              </label>
              <div className="space-y-3">
                {transactions.filter(t => isSameDay(parseISO(t.date), selectedDate)).map(t => (
                  <div 
                    key={t.id} 
                    onDoubleClick={() => openForm(selectedDate, t)}
                    className={`flex items-center justify-between p-3 rounded-xl transition-all select-none cursor-pointer hover:border-[#007AFF]/30 ${t.isActive ? 'bg-gray-50 border border-transparent' : 'bg-white border border-gray-100 opacity-40'}`}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className={`text-xs font-semibold truncate ${!t.isActive ? 'line-through' : ''}`}>
                        {t.memo || (t.type === 'income' ? '수입' : '지출')}
                      </span>
                      <span className={`text-[10px] font-bold ${t.type === 'income' ? 'text-[#007AFF]' : 'text-[#FF3B30]'}`}>
                        {(t.type === 'income' ? '+' : '-') + t.amount.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button 
                        onClick={() => toggleTransaction(t.id)} 
                        className={`w-8 h-4.5 rounded-full flex items-center px-0.5 transition-all ${t.isActive ? 'bg-[#007AFF] justify-end' : 'bg-gray-300 justify-start'}`}
                      >
                        <div className="w-3.5 h-3.5 bg-white rounded-full shadow-sm" />
                      </button>
                      <button onClick={() => openForm(selectedDate, t)} className="p-1 text-gray-400 hover:text-[#007AFF] transition-colors">
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button onClick={() => deleteTransaction(t.id)} className="p-1 text-gray-400 hover:text-red-500 transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
                {transactions.filter(t => isSameDay(parseISO(t.date), selectedDate)).length === 0 && (
                  <div className="text-center py-6 text-xs text-gray-400 italic">
                    내역이 없습니다.
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="pt-6 space-y-2 mt-auto">
          <button 
            onClick={() => {
              openForm(selectedDate);
              setIsSidebarOpen(false);
            }}
            className="w-full py-3 bg-[#007AFF] text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors shadow-sm active:scale-95"
          >
            기록 추가하기
          </button>
          <button 
            onClick={() => {
              setIsResetModalOpen(true);
              setIsSidebarOpen(false);
            }}
            className="w-full py-3 bg-white text-[#FF3B30] border border-red-100 rounded-xl font-semibold text-sm hover:bg-red-50 transition-colors shadow-sm active:scale-95"
          >
            데이터 초기화
          </button>
          <div className="flex gap-2 pt-2">
            <button 
              onClick={() => { openDataSyncModal('export'); setIsSidebarOpen(false); }}
              className="flex-1 py-2.5 bg-white text-gray-700 border border-gray-200 rounded-xl font-semibold text-xs hover:bg-gray-50 transition-colors shadow-sm active:scale-95 flex items-center justify-center gap-1.5"
            >
              <Upload size={14} /> 내보내기
            </button>
            <button 
              onClick={() => { openDataSyncModal('import'); setIsSidebarOpen(false); }}
              className="flex-1 py-2.5 bg-white text-gray-700 border border-gray-200 rounded-xl font-semibold text-xs hover:bg-gray-50 transition-colors shadow-sm active:scale-95 flex items-center justify-center gap-1.5"
            >
              <Download size={14} /> 불러오기
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-30 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8 flex flex-col items-center bg-[#F8F9FA]">
        <div className="w-full max-w-5xl flex flex-col gap-8 pb-8">
          <button 
            onClick={loadPreviousMonth}
            className="w-full py-3 border-2 border-dashed border-gray-200 text-gray-400 font-bold rounded-xl hover:bg-white hover:text-[#007AFF] hover:border-[#007AFF]/30 transition-all flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" /> 이전 달력 추가
          </button>

          {months.map(month => renderCalendar(month))}

          <button 
            onClick={loadNextMonth}
            className="w-full py-3 border-2 border-dashed border-gray-200 text-gray-400 font-bold rounded-xl hover:bg-white hover:text-[#007AFF] hover:border-[#007AFF]/30 transition-all flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" /> 다음 달력 추가
          </button>
        </div>
      </main>

      {/* Transaction Entry Modal - Bottom Sheet on mobile */}
      <AnimatePresence>
        {isFormOpen && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end lg:items-center justify-center">
            <motion.div 
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white w-full max-w-lg lg:max-w-sm rounded-t-3xl lg:rounded-2xl shadow-xl p-6 lg:p-6 border-t lg:border border-gray-100 pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:pb-6"
            >
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 lg:hidden" />
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold">
                  {format(formDate, 'M월 d일', { locale: ko })} {editingId ? '내역 수정' : '내역 추가'}
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
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">구분</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setFormType('income')}
                      className={`py-2.5 rounded-lg font-semibold text-sm transition-all border ${formType === 'income' ? 'bg-[#007AFF]/10 border-[#007AFF] text-[#007AFF]' : 'bg-gray-50 border-gray-100 text-gray-500'}`}
                    >
                      수입
                    </button>
                    <button 
                      onClick={() => setFormType('expense')}
                      className={`py-2.5 rounded-lg font-semibold text-sm transition-all border ${formType === 'expense' ? 'bg-[#FF3B30]/10 border-[#FF3B30] text-[#FF3B30]' : 'bg-gray-50 border-gray-100 text-gray-500'}`}
                    >
                      지출
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">금액</label>
                  <div className="relative">
                    <input 
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formAmount}
                      onChange={handleAmountChange}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg py-3 px-4 text-base font-bold focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 transition-all"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 font-bold">₩</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">메모</label>
                  <input 
                    type="text"
                    placeholder="내용 입력..."
                    value={formMemo}
                    onChange={(e) => setFormMemo(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg py-3 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 transition-all"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button 
                    onClick={() => setIsFormOpen(false)}
                    className="flex-1 py-3 text-gray-500 text-sm font-semibold hover:bg-gray-50 rounded-lg transition-all"
                  >
                    취소
                  </button>
                  <button 
                    id="save-btn"
                    onClick={addTransaction}
                    className="flex-[2] py-3 bg-[#007AFF] text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-all shadow-sm"
                  >
                    저장하기
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reset Confirmation Modal */}
      <AnimatePresence>
        {isResetModalOpen && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end lg:items-center justify-center">
            <motion.div 
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white w-full max-w-lg lg:max-w-sm rounded-t-3xl lg:rounded-2xl shadow-xl p-6 border-t lg:border border-gray-100 text-center pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:pb-6"
            >
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 lg:hidden" />
              <h3 className="text-lg font-bold mb-2 text-gray-900">
                데이터 초기화
              </h3>
              <p className="text-sm text-gray-500 mb-6">
                입력한 모든 거래 내역과 설정이 삭제되며, 이 작업은 되돌릴 수 없습니다. 정말로 초기화하시겠습니까?
              </p>
              <div className="flex gap-2">
                <button 
                  onClick={() => setIsResetModalOpen(false)}
                  className="flex-1 py-3 text-gray-500 text-sm font-semibold hover:bg-gray-50 rounded-lg transition-all"
                >
                  취소
                </button>
                <button 
                  onClick={handleReset}
                  className="flex-1 py-3 bg-[#FF3B30] text-white rounded-lg font-semibold text-sm hover:bg-red-600 transition-all shadow-sm"
                >
                  초기화하기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Data Sync Modal */}
      <AnimatePresence>
        {isDataSyncModalOpen && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end lg:items-center justify-center">
            <motion.div 
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white w-full max-w-lg lg:max-w-md rounded-t-3xl lg:rounded-2xl shadow-xl p-6 lg:p-6 border-t lg:border border-gray-100 flex flex-col max-h-[80vh] pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:pb-6"
            >
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 lg:hidden shrink-0" />
              <div className="flex justify-between items-center mb-4 shrink-0">
                <h3 className="text-lg font-bold">
                  {dataSyncMode === 'export' ? '데이터 내보내기' : '데이터 불러오기'}
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
                    ? '아래 텍스트를 복사하여 다른 기기나 브라우저에서 사용할 수 있습니다.'
                    : '내보내기한 텍스트를 아래에 붙여넣어주세요.'}
                </p>
                <textarea
                  value={syncText}
                  onChange={(e) => setSyncText(e.target.value)}
                  readOnly={dataSyncMode === 'export'}
                  className="w-full h-48 bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 resize-none font-mono break-all"
                  placeholder={dataSyncMode === 'import' ? '이곳에 텍스트를 붙여넣으세요...' : ''}
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
                  className="flex-1 py-3 text-gray-500 text-sm font-semibold hover:bg-gray-50 rounded-xl border border-gray-200 transition-all"
                >
                  취소
                </button>
                {dataSyncMode === 'export' ? (
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(syncText).then(() => {
                        alert('텍스트가 복사되었습니다!');
                      }).catch(() => {
                        alert('복사에 실패했습니다. 직접 선택하여 복사해주세요.');
                      });
                    }}
                    className="flex-[2] py-3 bg-[#007AFF] text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-all shadow-sm"
                  >
                    텍스트 복사하기
                  </button>
                ) : (
                  <button 
                    onClick={handleImport}
                    className="flex-[2] py-3 bg-[#007AFF] text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-all shadow-sm"
                  >
                    데이터 적용하기
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
