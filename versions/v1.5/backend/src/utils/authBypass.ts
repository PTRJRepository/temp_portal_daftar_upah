import { Config } from "../config";
import { AuthService } from "../services/authService";
import { User, UserRole } from "../types/user";

export type HeaderMap = Record<string, string | undefined>;

export interface TokenVerifier {
    verifyToken(token: string): Promise<User | null>;
}

export interface ResolveUserOptions {
    allowSystemToken?: boolean;
}

export function getAuthorizationHeader(headers: HeaderMap): string | undefined {
    return headers["authorization"] ?? headers["Authorization"];
}

export function getApiKeyHeader(headers: HeaderMap): string | undefined {
    return headers["x-api-key"] ?? headers["X-API-Key"];
}

export function hasBearerAuthorization(headers: HeaderMap): boolean {
    const authHeader = getAuthorizationHeader(headers);
    return !!(authHeader && authHeader.startsWith("Bearer "));
}

export function hasValidApiKeyBypass(headers: HeaderMap): boolean {
    const configuredApiKey = Config.API_KEY_BYPASS?.trim();
    if (!configuredApiKey) return false;

    const requestApiKey = getApiKeyHeader(headers)?.trim();
    return !!requestApiKey && requestApiKey === configuredApiKey;
}

export function isBearerOrApiKeyAuthorized(headers: HeaderMap): boolean {
    return hasBearerAuthorization(headers) || hasValidApiKeyBypass(headers);
}

export function buildApiKeyBypassUser(): User {
    return {
        id: 0,
        username: "api_key_admin",
        email: "apikey@admin.com",
        full_name: "API Key Admin (Bypass)",
        role: UserRole.ADMIN,
        divisions: [...AuthService.ALL_DIVISIONS],
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
    };
}

export function buildSystemBypassUser(): User {
    return {
        id: 0,
        username: "system",
        email: "system@internal.local",
        full_name: "System Internal",
        role: UserRole.ADMIN,
        divisions: [...AuthService.ALL_DIVISIONS],
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
    };
}

export function getForwardAuthorizationHeader(headers: HeaderMap): string | undefined {
    const authHeader = getAuthorizationHeader(headers);
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader;
    }

    if (!hasValidApiKeyBypass(headers)) {
        return undefined;
    }

    // Some internal services still expect a Bearer header string.
    const fallbackToken = Config.DEV_BYPASS_TOKEN || Config.SYSTEM_TOKEN;
    return `Bearer ${fallbackToken}`;
}

export async function resolveUserFromHeaders(
    headers: HeaderMap,
    tokenVerifier: TokenVerifier,
    options: ResolveUserOptions = {}
): Promise<User | null> {
    if (hasValidApiKeyBypass(headers)) {
        return buildApiKeyBypassUser();
    }

    const authHeader = getAuthorizationHeader(headers);
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
        return null;
    }

    if (options.allowSystemToken && token === Config.SYSTEM_TOKEN) {
        return buildSystemBypassUser();
    }

    return tokenVerifier.verifyToken(token);
}
