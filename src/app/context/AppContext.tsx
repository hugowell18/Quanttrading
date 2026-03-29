import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { AppContextValue, DebugLog, PageType } from '../types/api';

const AppContext = createContext<AppContextValue | null>(null);

function getFallbackDate(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedStock, setSelectedStock] = useState<string>('');
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [currentPage, setCurrentPage] = useState<PageType>('market');

  useEffect(() => {
    fetch('http://localhost:3001/api/ztpool/dates')
      .then((res) => res.json())
      .then((json) => {
        const dates: string[] = json?.data;
        if (Array.isArray(dates) && dates.length > 0) {
          setSelectedDate(dates[dates.length - 1]);
        } else {
          setSelectedDate(getFallbackDate());
        }
      })
      .catch(() => {
        setSelectedDate(getFallbackDate());
      });
  }, []);

  const pushDebugLog = useCallback((log: Omit<DebugLog, 'id' | 'timestamp'>) => {
    const entry: DebugLog = {
      ...log,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    };
    setDebugLogs((prev) => [...prev, entry]);
  }, []);

  const clearDebugLogs = useCallback(() => {
    setDebugLogs([]);
  }, []);

  const navigateToStock = useCallback((code: string) => {
    setSelectedStock(code);
    setCurrentPage('analyzer');
  }, []);

  const value: AppContextValue = {
    selectedDate,
    selectedStock,
    debugLogs,
    currentPage,
    setSelectedDate,
    setSelectedStock,
    setCurrentPage,
    pushDebugLog,
    clearDebugLogs,
    navigateToStock,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return ctx;
}
