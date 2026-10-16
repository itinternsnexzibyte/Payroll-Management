'use client';
import { useQuery } from '@tanstack/react-query';
import { get } from '@nexzi/ui';
import type { InputDefinition, Master, SalaryComponent } from './types';

export const useDepartments = () => useQuery({ queryKey: ['departments'], queryFn: () => get<Master[]>('/departments'), staleTime: 60_000 });
export const useDesignations = () => useQuery({ queryKey: ['designations'], queryFn: () => get<Master[]>('/designations'), staleTime: 60_000 });
export const useComponents = (enabled = true) =>
  useQuery({ queryKey: ['salary-components'], queryFn: () => get<{ items: SalaryComponent[]; availableFormulas: { key: string; label: string }[] }>('/salary-components'), enabled });
export const useInputDefinitions = (enabled = true) => useQuery({ queryKey: ['input-definitions'], queryFn: () => get<InputDefinition[]>('/payroll-input-definitions'), enabled });
