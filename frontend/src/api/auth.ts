import { apiClient } from './client';

export interface LoginCredentials {
    email: string;
    password: string;
}

export interface RegisterData {
    email: string;
    password: string;
    full_name: string;
    role?: string;
    /** Optional: link the new account to a Faculty row with this email. */
    faculty_email?: string;
    /** Canonical link — the user picks their faculty/department on signup. */
    department_id?: string;
}

export interface User {
    id: string;
    email: string;
    full_name: string;
    role: string;
    is_active: boolean;
    faculty_id?: string | null;
    department_id?: string | null;
}

export interface MeResponse extends User {
    department_code?: string | null;
    department_name?: string | null;
    faculty_first_name?: string | null;
    faculty_last_name?: string | null;
}

export interface AuthResponse {
    access_token: string;
    token_type: string;
}

export const authApi = {
    login: async (credentials: LoginCredentials) => {
        const formData = new URLSearchParams();
        formData.append('username', credentials.email);
        formData.append('password', credentials.password);

        const response = await apiClient.post<AuthResponse>('/auth/login', formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return response.data;
    },

    register: async (data: RegisterData) => {
        const response = await apiClient.post<User>('/auth/register', data);
        return response.data;
    },

    me: async () => {
        const response = await apiClient.get<MeResponse>('/auth/me');
        return response.data;
    },
};
