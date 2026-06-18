'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { getDepartments, getDivisions, getOffices, getRoles, getBranches, getDistricts, getCustomers } from '@/app/actions/admin';
import type { Department, Division, Office, Role, Branch, District, Customer } from '@/lib/types';
import { handleActionError } from '@/lib/error-handler';

interface AdminDataContextType {
    roles: Role[];
    offices: Office[];
    departments: Department[];
    divisions: Division[];
    districts: District[];
    branches: Branch[];
    customers: Customer[];
    loading: boolean;
    mutate: () => Promise<void>;
}

const AdminDataContext = createContext<AdminDataContextType | undefined>(undefined);

export function AdminDataProvider({ children }: { children: ReactNode }) {
    const [data, setData] = useState<Omit<AdminDataContextType, 'loading' | 'mutate'>>({
        roles: [], offices: [], departments: [], divisions: [], districts: [], branches: [], customers: []
    });
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [roles, offices, departments, divisions, districts, branches, customers] = await Promise.all([
                getRoles(),
                getOffices(),
                getDepartments(),
                getDivisions(),
                getDistricts(),
                getBranches(),
                getCustomers(),
            ]);
            setData({ roles, offices, departments, divisions, districts, branches, customers } as any);
        } catch (error) {
            console.error("Failed to fetch admin data:", error);
            handleActionError(error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const value = { ...data, loading, mutate: fetchData };

    return React.createElement(AdminDataContext.Provider, { value: value }, children);
}

export function useAdminData() {
    const context = useContext(AdminDataContext);
    if (!context) {
        throw new Error('useAdminData must be used within an AdminDataProvider');
    }
    return context;
}

// Individual hooks that consume the context
export const useRoles = () => { const { roles, loading, mutate } = useAdminData(); return { data: roles, loading, mutate }; };
export const useOffices = () => { const { offices, loading, mutate } = useAdminData(); return { data: offices, loading, mutate }; };
export const useDepartments = () => { const { departments, loading, mutate } = useAdminData(); return { data: departments, loading, mutate }; };
export const useDivisions = () => { const { divisions, loading, mutate } = useAdminData(); return { data: divisions, loading, mutate }; };
export const useDistricts = () => { const { districts, loading, mutate } = useAdminData(); return { data: districts, loading, mutate }; };
export const useBranches = () => { const { branches, loading, mutate } = useAdminData(); return { data: branches, loading, mutate }; };
export const useCustomers = () => { const { customers, loading, mutate } = useAdminData(); return { data: customers, loading, mutate }; };
