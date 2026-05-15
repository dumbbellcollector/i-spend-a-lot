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
  HelpCircle,
  TrendingDown,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import LZString from 'lz-string';

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
  const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false);
  const [dataSyncMode, setDataSyncMode] = useState<'export' | 'import'>('export');
  const [syncText, setSyncText] = useState('');
  const [syncError, setSyncError] = useState('');
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [isDeathValleyModalOpen, setIsDeathValleyModalOpen] = useState(false);
  const [titleTapCount, setTitleTapCount] = useState(0);
  const [showEasterEgg, setShowEasterEgg] = useState(false);
  const [isComradeMode, setIsComradeMode] = useState(false);

  const amountInputRef = useRef<HTMLInputElement>(null);

  const t = (str: string) => {
    if (!isComradeMode) return str;
    const dict: Record<string, string> = {
      '현금 흐름': '자금 류통',
      '현금 흐름 시뮬레이터': '인민 화폐 류통 시뮬레이터',
      'Cash Flow Simulation': '배급표 계산기',
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
    };
    return dict[str] || str;
  };

  const formatCurrency = (amount: number) => {
    const numStr = amount.toLocaleString();
    return isComradeMode ? `${numStr}억 원` : `${numStr}₩`;
  };

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
      let decoded = '';
      const text = syncText.trim();
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
      } else if (typeof data.initialBalance === 'number' && Array.isArray(data.transactions)) {
        importedInitialBalance = data.initialBalance;
        importedTransactions = data.transactions;
      } else {
        setSyncError('잘못된 데이터 형식입니다.');
        return;
      }

      setInitialBalance(importedInitialBalance);
      setTransactions(importedTransactions);
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

  const deathValleyInfo = useMemo(() => {
    let minBalance = Infinity;
    let minDate = '';
    
    Object.entries(simulationData).forEach(([date, data]) => {
      if (data.balance < minBalance) {
        minBalance = data.balance;
        minDate = date;
      }
    });

    if (minBalance === Infinity || Object.keys(simulationData).length === 0) return null;
    return { date: parseISO(minDate), balance: minBalance };
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
                onClick={() => {
                  setSelectedDate(day);
                  if (window.innerWidth < 1024) {
                    setIsBottomSheetOpen(true);
                  }
                }}
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
          <h1 
            className="text-base font-bold tracking-tight select-none cursor-pointer active:scale-95 transition-transform"
            onClick={handleTitleClick}
          >
            {t('현금 흐름')}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {(() => {
            const finalBalance = simulationData[format(endOfMonth(months[months.length - 1]), 'yyyy-MM-dd')]?.balance ?? initialBalance;
            const isNegative = finalBalance < 0;
            return deathValleyInfo ? (
              <button 
                onClick={() => setIsDeathValleyModalOpen(true)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold transition-colors active:scale-95 ${
                  isNegative ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'
                }`}
              >
                <TrendingDown className="w-3.5 h-3.5" /> {isNegative ? '추경 필요' : '건전재정'}
              </button>
            ) : null;
          })()}
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
        <div className="flex items-center justify-between mb-6">
          <div className="flex flex-col">
            <h1 
              className="text-lg font-bold tracking-tight mb-0.5 select-none hover:text-[#007AFF] transition-colors cursor-pointer"
              onClick={handleTitleClick}
            >
              {t('현금 흐름')}
            </h1>
            <p className="text-[10px] text-gray-500">{t('Cash Flow Simulation')}</p>
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
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">{t('기초 자산 설정')}</label>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                value={new Intl.NumberFormat('ko-KR').format(initialBalance)}
                onChange={handleInitialBalanceChange}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-base font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">{isComradeMode ? '억 원' : '₩'}</span>
            </div>
          </section>

          <section className="bg-white border border-[#E5E7EB] rounded-xl p-3 space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-600">{t('총 수입 (예정)')}</span>
              <span className="font-semibold text-[#007AFF]">
                +{formatCurrency(transactions.filter(t => t.isActive && t.type === 'income').reduce((s,tx) => s+tx.amount, 0))}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-600">{t('총 지출 (예정)')}</span>
              <span className="font-semibold text-[#FF3B30]">
                -{formatCurrency(transactions.filter(t => t.isActive && t.type === 'expense').reduce((s,tx) => s+tx.amount, 0))}
              </span>
            </div>
            <div className="h-px bg-gray-100 my-1"></div>
            <div className="flex justify-between items-end">
              <span className="text-sm font-medium flex items-center gap-1">
                {t('기말 잔액')}
                <button 
                  onClick={() => setIsHelpModalOpen(true)}
                  className="text-gray-400 hover:text-[#007AFF] transition-colors p-0.5"
                >
                  <HelpCircle className="w-4 h-4" />
                </button>
              </span>
              <span className="text-base font-bold text-[#1C1C1E]">
                {formatCurrency(simulationData[format(endOfMonth(months[months.length - 1]), 'yyyy-MM-dd')]?.balance ?? initialBalance)}
              </span>
            </div>
          </section>

          <div className="hidden lg:block">
          {selectedDate && (
            <section>
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3 block">
                {format(selectedDate, 'M월 d일', { locale: ko })} 내역
              </label>
              <div className="space-y-3">
                {transactions.filter(tx => isSameDay(parseISO(tx.date), selectedDate)).map(tx => (
                  <div 
                    key={tx.id} 
                    onDoubleClick={() => openForm(selectedDate, tx)}
                    className={`flex items-center justify-between p-3 rounded-xl transition-all select-none cursor-pointer hover:border-[#007AFF]/30 ${tx.isActive ? 'bg-gray-50 border border-transparent' : 'bg-white border border-gray-100 opacity-40'}`}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className={`text-xs font-semibold truncate ${!tx.isActive ? 'line-through' : ''}`}>
                        {tx.memo || (tx.type === 'income' ? t('수입') : t('지출'))}
                      </span>
                      <span className={`text-[10px] font-bold ${tx.type === 'income' ? 'text-[#007AFF]' : 'text-[#FF3B30]'}`}>
                        {(tx.type === 'income' ? '+' : '-') + formatCurrency(tx.amount)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button 
                        onClick={() => toggleTransaction(tx.id)} 
                        className={`w-8 h-4.5 rounded-full flex items-center px-0.5 transition-all ${tx.isActive ? 'bg-[#007AFF] justify-end' : 'bg-gray-300 justify-start'}`}
                      >
                        <div className="w-3.5 h-3.5 bg-white rounded-full shadow-sm" />
                      </button>
                      <button onClick={() => openForm(selectedDate, tx)} className="p-1 text-gray-400 hover:text-[#007AFF] transition-colors">
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button onClick={() => deleteTransaction(tx.id)} className="p-1 text-gray-400 hover:text-red-500 transition-colors">
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
        </div>

        <div className="pt-6 space-y-2 mt-auto">
          <button 
            onClick={() => {
              openForm(selectedDate);
              setIsSidebarOpen(false);
            }}
            className="w-full py-3 bg-[#007AFF] text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors shadow-sm active:scale-95"
          >
            {t('기록 추가하기')}
          </button>
          <button 
            onClick={() => {
              setIsResetModalOpen(true);
              setIsSidebarOpen(false);
            }}
            className="w-full py-3 bg-white text-[#FF3B30] border border-red-100 rounded-xl font-semibold text-sm hover:bg-red-50 transition-colors shadow-sm active:scale-95"
          >
            {t('데이터 초기화')}
          </button>
          <div className="flex gap-2 pt-2">
            <button 
              onClick={() => { openDataSyncModal('export'); setIsSidebarOpen(false); }}
              className="flex-1 py-2.5 bg-white text-gray-700 border border-gray-200 rounded-xl font-semibold text-xs hover:bg-gray-50 transition-colors shadow-sm active:scale-95 flex items-center justify-center gap-1.5"
            >
              <Upload size={14} /> {t('내보내기')}
            </button>
            <button 
              onClick={() => { openDataSyncModal('import'); setIsSidebarOpen(false); }}
              className="flex-1 py-2.5 bg-white text-gray-700 border border-gray-200 rounded-xl font-semibold text-xs hover:bg-gray-50 transition-colors shadow-sm active:scale-95 flex items-center justify-center gap-1.5"
            >
              <Download size={14} /> {t('불러오기')}
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
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={0.2}
              onDragEnd={(e, info) => {
                if (info.offset.y > 100) {
                  setIsBottomSheetOpen(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#F9FAFB] w-full rounded-t-3xl shadow-xl flex flex-col max-h-[85vh] absolute bottom-0"
            >
              <div 
                className="w-full pt-4 pb-3 flex justify-center items-center cursor-ns-resize touch-none"
              >
                <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
              </div>
              <div className="px-6 pb-4 border-b border-gray-200 shrink-0">
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
                  const dayTransactions = transactions.filter(tx => isSameDay(parseISO(tx.date), selectedDate) && tx.isActive);
                  const income = dayTransactions.filter(tx => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0);
                  const expense = dayTransactions.filter(tx => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0);
                  const total = income - expense;
                  return (
                    <div className="text-[13px] font-medium text-gray-600 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[#007AFF]">+{formatCurrency(income)}</span>
                      <span className="text-gray-400">-</span>
                      <span className="text-[#FF3B30]">{formatCurrency(expense)}</span>
                      <span className="text-gray-400">=</span>
                      <span className={`font-bold ${total >= 0 ? 'text-[#007AFF]' : 'text-[#FF3B30]'}`}>
                        {total > 0 ? '+' : ''}{formatCurrency(total)}
                      </span>
                    </div>
                  );
                })()}
              </div>

              <div className="flex-1 overflow-y-auto px-0 py-0 overscroll-contain bg-white pb-6">
                <div className="divide-y divide-gray-100 border-b border-gray-100">
                {transactions.filter(tx => isSameDay(parseISO(tx.date), selectedDate)).map(tx => (
                  <div key={tx.id} className="relative bg-gray-50 overflow-hidden">
                    <div className="absolute inset-y-0 right-0 flex items-stretch">
                      <button 
                        onClick={() => deleteTransaction(tx.id)}
                        className="px-5 bg-[#FF3B30] text-white flex items-center justify-center font-bold text-xs"
                      >
                        {t('삭제')}
                      </button>
                    </div>
                    <motion.div 
                      drag="x"
                      dragConstraints={{ left: -70, right: 0 }}
                      dragElastic={0.1}
                      onClick={() => { setIsBottomSheetOpen(false); openForm(selectedDate, tx); }}
                      className={`relative flex items-center justify-between p-4 px-6 transition-colors select-none ${tx.isActive ? 'bg-white' : 'bg-gray-100'}`}
                    >
                      <div className={`flex flex-col min-w-0 pr-2 ${!tx.isActive ? 'opacity-40' : ''}`}>
                        <span className={`text-[13px] font-semibold truncate ${!tx.isActive ? 'line-through' : ''}`}>
                          {tx.memo || (tx.type === 'income' ? t('수입') : t('지출'))}
                        </span>
                        <span className={`text-[12px] mt-0.5 font-bold ${tx.type === 'income' ? 'text-[#007AFF]' : 'text-[#FF3B30]'}`}>
                          {(tx.type === 'income' ? '+' : '-') + formatCurrency(tx.amount)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 pr-2">
                        <button 
                          onClick={(e) => { e.stopPropagation(); toggleTransaction(tx.id); }} 
                          onPointerDownCapture={e => e.stopPropagation()}
                          className={`w-10 h-5.5 rounded-full flex items-center px-0.5 transition-all ${tx.isActive ? 'bg-[#007AFF] justify-end' : 'bg-gray-300 justify-start'}`}
                        >
                          <div className="w-4.5 h-4.5 bg-white rounded-full shadow-sm" />
                        </button>
                      </div>
                    </motion.div>
                  </div>
                ))}
                {transactions.filter(t => isSameDay(parseISO(t.date), selectedDate)).length === 0 && (
                  <div className="text-center py-10 text-sm text-gray-400">
                    등록된 내역이 없습니다.
                  </div>
                )}
                </div>
              </div>

              <div className="p-6 border-t border-gray-200 shrink-0 bg-white pb-[calc(1.5rem+env(safe-area-inset-bottom))] flex gap-3">
                <button 
                  onClick={() => {
                    setIsBottomSheetOpen(false);
                    openForm(selectedDate, undefined, 'income');
                  }}
                  className="flex-1 py-3.5 bg-[#007AFF]/10 text-[#007AFF] rounded-xl font-bold text-sm hover:bg-[#007AFF]/20 transition-colors shadow-sm border border-[#007AFF]/20 active:scale-95 flex justify-center items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> {t('수입 기록')}
                </button>
                <button 
                  onClick={() => {
                    setIsBottomSheetOpen(false);
                    openForm(selectedDate, undefined, 'expense');
                  }}
                  className="flex-1 py-3.5 bg-[#FF3B30]/10 text-[#FF3B30] rounded-xl font-bold text-sm hover:bg-[#FF3B30]/20 transition-colors shadow-sm border border-[#FF3B30]/20 active:scale-95 flex justify-center items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> {t('지출 기록')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8 flex flex-col items-center bg-[#F8F9FA]">
        <div className="w-full max-w-5xl flex flex-col gap-8 pb-8">
          <button 
            onClick={loadPreviousMonth}
            className="w-full py-3 border-2 border-dashed border-gray-200 text-gray-400 font-bold rounded-xl hover:bg-white hover:text-[#007AFF] hover:border-[#007AFF]/30 transition-all flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" /> {t('이전 달력 추가')}
          </button>

          {months.map(month => renderCalendar(month))}

          <button 
            onClick={loadNextMonth}
            className="w-full py-3 border-2 border-dashed border-gray-200 text-gray-400 font-bold rounded-xl hover:bg-white hover:text-[#007AFF] hover:border-[#007AFF]/30 transition-all flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" /> {t('다음 달력 추가')}
          </button>
        </div>
      </main>

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
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white w-full max-w-lg lg:max-w-sm rounded-t-3xl lg:rounded-2xl shadow-xl p-6 lg:p-6 border-t lg:border border-gray-100 pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:pb-6"
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
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">구분</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setFormType('income')}
                      className={`py-2.5 rounded-lg font-semibold text-sm transition-all border ${formType === 'income' ? 'bg-[#007AFF]/10 border-[#007AFF] text-[#007AFF]' : 'bg-gray-50 border-gray-100 text-gray-500'}`}
                    >
                      {t('수입')}
                    </button>
                    <button 
                      onClick={() => setFormType('expense')}
                      className={`py-2.5 rounded-lg font-semibold text-sm transition-all border ${formType === 'expense' ? 'bg-[#FF3B30]/10 border-[#FF3B30] text-[#FF3B30]' : 'bg-gray-50 border-gray-100 text-gray-500'}`}
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
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg py-3 px-4 text-base font-bold focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 transition-all"
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
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg py-3 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 transition-all"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button 
                    onClick={() => setIsFormOpen(false)}
                    className="flex-1 py-3 text-gray-500 text-sm font-semibold hover:bg-gray-50 rounded-lg transition-all"
                  >
                    {t('취소')}
                  </button>
                  <button 
                    id="save-btn"
                    onClick={addTransaction}
                    className="flex-[2] py-3 bg-[#007AFF] text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-all shadow-sm"
                  >
                    {t('저장하기')}
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
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end lg:items-center justify-center"
            onClick={() => setIsResetModalOpen(false)}
          >
            <motion.div 
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white w-full max-w-lg lg:max-w-sm rounded-t-3xl lg:rounded-2xl shadow-xl p-6 border-t lg:border border-gray-100 text-center pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:pb-6"
            >
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 lg:hidden" />
              <h3 className="text-lg font-bold mb-2 text-gray-900">
                {t('데이터 초기화')}
              </h3>
              <p className="text-sm text-gray-500 mb-6">
                {isComradeMode ? '위대한 수령님의 지시로 모든 배급 기록이 처단되며, 돌이킬 수 없소. 진정 혁명하시갔소?' : '입력한 모든 거래 내역과 설정이 삭제되며, 이 작업은 되돌릴 수 없습니다. 정말로 초기화하시겠습니까?'}
              </p>
              <div className="flex gap-2">
                <button 
                  onClick={() => setIsResetModalOpen(false)}
                  className="flex-1 py-3 text-gray-500 text-sm font-semibold hover:bg-gray-50 rounded-lg transition-all"
                >
                  {t('취소')}
                </button>
                <button 
                  onClick={handleReset}
                  className="flex-[2] py-3 bg-[#FF3B30] text-white rounded-lg font-semibold text-sm hover:bg-red-600 transition-all shadow-sm"
                >
                  {isComradeMode ? '혁명수행' : '초기화하기'}
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
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6 border border-gray-100"
            >
              <div className="flex justify-between items-center mb-5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center text-orange-600">
                    <TrendingDown className="w-4 h-4" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900">데스 밸리 예측</h3>
                </div>
                <button 
                  onClick={() => setIsDeathValleyModalOpen(false)}
                  className="p-2 text-gray-400 bg-gray-50 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {deathValleyInfo ? (
                <div className="space-y-4">
                  <div className="p-4 bg-orange-50/50 border border-orange-100 rounded-xl">
                    <p className="text-xs text-orange-800 font-medium mb-1">예상 최저 잔액 발생일</p>
                    <p className="text-lg font-bold text-orange-600">
                      {format(deathValleyInfo.date, 'yyyy년 M월 d일', { locale: ko })}
                    </p>
                  </div>
                  <div className="p-4 bg-gray-50 border border-gray-100 rounded-xl flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-600">해당일 잔고 예측</span>
                    <span className={`text-lg font-bold ${deathValleyInfo.balance < 0 ? 'text-[#FF3B30]' : 'text-gray-900'}`}>
                      {formatCurrency(deathValleyInfo.balance)}
                    </span>
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

              <div className="mt-6 pt-4 border-t border-gray-100">
                <button 
                  onClick={() => setIsDeathValleyModalOpen(false)}
                  className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold text-sm hover:bg-gray-800 transition-colors active:scale-95"
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
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white w-full max-w-lg lg:max-w-md rounded-t-3xl lg:rounded-2xl shadow-xl p-6 lg:p-6 border-t lg:border border-gray-100 flex flex-col max-h-[80vh] pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:pb-6"
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
                  className="w-full h-48 bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 resize-none font-mono break-all"
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
                  className="flex-1 py-3 text-gray-500 text-sm font-semibold hover:bg-gray-50 rounded-xl border border-gray-200 transition-all"
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
                    className="flex-[2] py-3 bg-[#007AFF] text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-all shadow-sm"
                  >
                    {t('텍스트 복사하기')}
                  </button>
                ) : (
                  <button 
                    onClick={handleImport}
                    className="flex-[2] py-3 bg-[#007AFF] text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-all shadow-sm"
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
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white w-full max-w-lg lg:max-w-sm rounded-t-3xl lg:rounded-2xl shadow-xl p-6 border-t lg:border border-gray-100 pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:pb-6"
            >
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 lg:hidden" />
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-[#007AFF]" /> {t('앱 사용 가이드')}
                </h3>
                <button onClick={() => setIsHelpModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 rounded-full bg-gray-50 hover:bg-gray-100">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-sm text-gray-600">
                <div className="p-3.5 bg-blue-50/50 rounded-xl border border-blue-100/50 leading-relaxed">
                  <strong className="block text-gray-900 mb-1"><span className="mr-1">📅</span>{t('내역 기입하기')}</strong>
                  {isComradeMode ? '달력 일자를 과감히 두 번 치시오. 공화국 번영을 위한 수입과 지출을 보고할 수 있소.' : '달력의 특정 날짜를 더블 클릭(탭)하면 해당 날짜에 수입과 지출을 추가할 수 있습니다.'}
                </div>
                <div className="p-3.5 bg-blue-50/50 rounded-xl border border-blue-100/50 leading-relaxed">
                  <strong className="block text-gray-900 mb-1"><span className="mr-1">💰</span>{t('시뮬레이션 토글')}</strong>
                  {isComradeMode ? '명단에서 전원을 내리면, 해당 항목이 제외된 인민 자산 총계가 어찌 되는지 똑똑히 볼 수 있소.' : '왼쪽 패널(모바일은 메뉴)에서 내역별 스위치를 끄면 해당 내역 금액이 제외된 잔액을 캘린더에서 즉시 확인할 수 있습니다.'}
                </div>
                <div className="p-3.5 bg-blue-50/50 rounded-xl border border-blue-100/50 leading-relaxed">
                  <strong className="block text-gray-900 mb-1"><span className="mr-1">📜</span>{t('무한 스크롤 달력')}</strong>
                  {isComradeMode ? '화면 우하단의 단추로 과거와 미래를 넘나들며 끝없이 로작을 남길 수 있소.' : '가운데 화면 상/하단의 이전/다음 달력 버튼을 눌러 원하는 기간까지 달력을 추가할 수 있습니다.'}
                </div>
              </div>
              
              <button 
                onClick={() => setIsHelpModalOpen(false)}
                className="w-full mt-6 py-3.5 bg-[#007AFF] text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors active:scale-95"
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
