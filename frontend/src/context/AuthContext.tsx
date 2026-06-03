import React, { createContext, useContext, useState, useEffect } from 'react';
import type { LoginCredentials, RegisterData, MeResponse } from '../api/auth';
import { authApi } from '../api/auth';

interface AuthContextType {
    isAuthenticated: boolean;
    token: string | null;
    me: MeResponse | null;
    isAdmin: boolean;
    isChair: boolean;
    isFaculty: boolean;
    login: (credentials: LoginCredentials) => Promise<void>;
    register: (data: RegisterData) => Promise<void>;
    logout: () => void;
    isLoading: boolean;
    error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
    const [me, setMe] = useState<MeResponse | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (token) {
            localStorage.setItem('token', token);
            authApi.me().then(setMe).catch(() => setMe(null));
        } else {
            localStorage.removeItem('token');
            setMe(null);
        }
    }, [token]);

    const login = async (credentials: LoginCredentials) => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await authApi.login(credentials);
            setToken(data.access_token);
            try { setMe(await authApi.me()); } catch { /* useEffect retries */ }
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Login failed');
            throw err;
        } finally {
            setIsLoading(false);
        }
    };

    const register = async (data: RegisterData) => {
        setIsLoading(true);
        setError(null);
        try {
            await authApi.register(data);
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Registration failed');
            throw err;
        } finally {
            setIsLoading(false);
        }
    };

    const logout = () => {
        setToken(null);
    };

    const role = (me?.role || '').toUpperCase();
    return (
        <AuthContext.Provider value={{
            isAuthenticated: !!token,
            token,
            me,
            isAdmin:   role === 'ADMIN',
            isChair:   role === 'CHAIR',
            isFaculty: role === 'FACULTY',
            login,
            register,
            logout,
            isLoading,
            error,
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
