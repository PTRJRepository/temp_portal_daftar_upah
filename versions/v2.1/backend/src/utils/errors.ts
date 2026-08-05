export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    public readonly category: string;

    constructor(message: string, statusCode: number = 500, category: string = "INTERNAL_ERROR", isOperational: boolean = true) {
        super(message);
        this.statusCode = statusCode;
        this.category = category;
        this.isOperational = isOperational;
        Object.setPrototypeOf(this, new.target.prototype);
        Error.captureStackTrace(this, this.constructor);
    }
}

export class DatabaseError extends AppError {
    constructor(message: string, statusCode: number = 500) {
        super(message, statusCode, "DATABASE_ERROR");
    }
}

export class ValidationError extends AppError {
    constructor(message: string) {
        super(message, 400, "VALIDATION_ERROR");
    }
}

export class NotFoundError extends AppError {
    constructor(message: string) {
        super(message, 404, "NOT_FOUND");
    }
}

export class UnauthorizedError extends AppError {
    constructor(message: string) {
        super(message, 401, "UNAUTHORIZED");
    }
}
