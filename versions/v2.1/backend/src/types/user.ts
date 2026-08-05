export enum UserRole {
    ADMIN = "admin",
    USER = "user",
    KERANI = "kerani",
    VISITOR = "visitor",
}

export interface User {
    id: number;
    username: string;
    email: string;
    full_name: string;
    role: UserRole;
    divisions: string[];
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}

export interface UserWithHash extends User {
    password_hash: string;
}

export interface UserCreate {
    username: string;
    email: string;
    password: string;
    full_name: string;
    role?: UserRole;
    divisions?: string[];
    is_active?: boolean;
}
