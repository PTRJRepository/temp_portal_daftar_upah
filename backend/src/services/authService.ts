import { Database } from "bun:sqlite";
import { Config } from "../config";
import { User, UserCreate, UserRole, UserWithHash } from "../types/user";
import * as bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, importSPKI, decodeProtectedHeader } from "jose";
import { join } from "path";

export class AuthService {
    private static instance: AuthService;
    private db: Database;
    private secret: Uint8Array;

    // List of all available divisions (Source of Truth)
    // Includes both real divisions AND virtual divisions for navigation
    // Virtual divisions (WKS_PG, WKS_AR, NRS, WORKSHOP, MILL, INF) are searchable/selectable
    // and the system derives their data from real source divisions at read time
    public static readonly ALL_DIVISIONS = [
        "PG1A", "PG1B", "PG2A", "PG2B", "PGE", "DME", "ARA", "ARB1", "ARB2",
        "INFRA", "IJL", "STF-OFFICE", "SECURITY",
        "ARC", "P1A", "P1B", "P2A", "P2B", "AB1", "AB2",
        // Virtual divisions for navigation/search
        "INF", "NRS", "WKS_AR", "WKS_PG", "WORKSHOP", "MILL"
    ];

    private constructor() {
        // DB Path: backend/data/users.db
        const dbPath = join(process.cwd(), "data", "users.db");
        console.log(`[AuthService] Opening SQLite DB: ${dbPath}`);
        this.db = new Database(dbPath, { create: true });
        this.secret = new TextEncoder().encode(Config.JWT_SECRET);

        this.initDb();
    }

    public static getInstance(): AuthService {
        if (!AuthService.instance) {
            AuthService.instance = new AuthService();
        }
        return AuthService.instance;
    }

    private initDb() {
        this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        divisions TEXT NOT NULL DEFAULT '[]',
        is_active BOOLEAN NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // Audit logs
        this.db.run(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            details TEXT,
            timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `);

        // Check admin
        const admin = this.db.query("SELECT * FROM users WHERE username = 'admin'").get();
        if (!admin) {
            console.log("[AuthService] Creating default admin user");
            const hash = bcrypt.hashSync("admin", 10);
            const allDivisions = JSON.stringify(AuthService.ALL_DIVISIONS);
            this.db.run(
                `INSERT INTO users (username, email, password_hash, full_name, role, divisions, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ["admin", "admin@payroll.com", hash, "System Administrator", "admin", allDivisions, true]
            );
        }
    }

    // --- User Management ---

    public async getUser(username: string): Promise<UserWithHash | null> {
        const row = this.db.query("SELECT * FROM users WHERE username = ?").get(username) as any;
        if (!row) return null;
        return this.mapRowToUser(row);
    }

    public async getUserById(id: number): Promise<User | null> {
        const row = this.db.query("SELECT * FROM users WHERE id = ?").get(id) as any;
        if (!row) return null;
        return this.mapRowToUser(row);
    }

    private mapRowToUser(row: any): UserWithHash {
        return {
            id: row.id,
            username: row.username,
            email: row.email,
            full_name: row.full_name,
            password_hash: row.password_hash,
            role: row.role as UserRole,
            divisions: JSON.parse(row.divisions || "[]"),
            is_active: !!row.is_active,
            created_at: new Date(row.created_at),
            updated_at: new Date(row.updated_at)
        };
    }

    // --- Authentication ---

    public async authenticate(username: string, password: string): Promise<User | null> {
        const user = await this.getUser(username);
        if (!user || !user.is_active) return null;

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return null;

        // Log login
        this.logAudit(user.id, "LOGIN_SUCCESS", `User ${username} logged in`);

        const { password_hash, ...safeUser } = user;
        return safeUser;
    }

    public async createToken(user: User): Promise<string> {
        const jwt = await new SignJWT({
            sub: user.username,
            role: user.role,
            divisions: user.divisions
        })
            .setProtectedHeader({ alg: "HS256" })
            .setIssuedAt()
            .setExpirationTime("24h") // Python was ACCESS_TOKEN_EXPIRE_MINUTES, default 30-60m usually, check Config? 
            .sign(this.secret);

        return jwt;
    }

    public async verifyToken(token: string): Promise<User | null> {
        try {
            console.log(`[AuthService] Verifying token. Token starts with: ${token.substring(0, 10)}...`);

            if (Config.DEV_BYPASS_TOKEN && token === Config.DEV_BYPASS_TOKEN) {
                console.log("[AuthService] Dev Bypass Token used. Granting ADMIN access.");
                return {
                    id: 0,
                    username: "dev_admin",
                    email: "dev@admin.com",
                    full_name: "Dev Admin (Bypass)",
                    role: UserRole.ADMIN,
                    divisions: AuthService.ALL_DIVISIONS,
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date()
                };
            }

            let payload;
            let header;
            try {
                header = decodeProtectedHeader(token);
            } catch (e) {
                console.error("[AuthService] Invalid token header:", e);
                return null;
            }

            if (header.alg === "HS256") {
                // Internal Token (always trusted verified by SECRET)
                try {
                    const result = await jwtVerify(token, this.secret);
                    payload = result.payload;
                } catch (e) {
                    console.error("[AuthService] Internal HS256 verification failed:", e);
                    return null;
                }
            } else if (header.alg === "RS256") {
                // External Token (verify with PUBLIC KEY)
                // HANYA dipercaya saat AUTH_MODE=external (di belakang proxy gateway).
                // AUTH_MODE=internal (standalone tanpa proxy) menolak RS256 supaya token
                // gateway bermode "super access" TIDAK diterima oleh backend langsung.
                if (Config.AUTH_MODE !== "external") {
                    console.error(`[AuthService] RS256 token ditolak: AUTH_MODE=${Config.AUTH_MODE} (RS256 hanya dipakai saat external/proxy)`);
                    return null;
                }
                try {
                    const pem = await Bun.file(Config.PUBLIC_KEY_PATH).text();
                    const publicKey = await importSPKI(pem, "RS256");
                    const result = await jwtVerify(token, publicKey, {
                        algorithms: ["RS256"]
                    });
                    payload = result.payload;
                    console.log("[AuthService] External token verified.");
                } catch (e) {
                    console.error("[AuthService] External RS256 verification failed:", e);
                    return null;
                }
            } else {
                console.error(`[AuthService] Unsupported token algorithm: ${header.alg}`);
                return null;
            }

            // Normalization and Mapping
            const username = payload.sub || (payload as any).preferred_username || (payload as any).username || (payload as any).email;

            if (!username) {
                console.log("[AuthService] No username found in token payload");
                // Optional debug log
                // console.log("Payload keys:", Object.keys(payload));
                return null;
            }

            if ((payload as any).userId && !payload.sub) {
                let roleStr = (payload as any).role || "user";
                if (typeof roleStr === "string") roleStr = roleStr.toLowerCase();

                let role = UserRole.USER;
                if (roleStr === "admin") role = UserRole.ADMIN;
                else if (roleStr === "kerani") role = UserRole.KERANI;
                else if (roleStr === "visitor") role = UserRole.VISITOR;

                const rawDivs = (payload as any).divisions || (payload as any).division || (payload as any).divisi || [];
                let divisions = Array.isArray(rawDivs)
                    ? rawDivs.map(d => String(d).trim()).filter(Boolean)
                    : String(rawDivs || '').split(',').map(d => d.trim()).filter(Boolean);

                if (divisions.length === 0 && role === UserRole.KERANI && String(username).toLowerCase().startsWith('kerani_')) {
                    divisions.push(String(username).substring(7).toUpperCase());
                }

                divisions = divisions.map(d => {
                    const strD = String(d).toUpperCase().trim();
                    if (strD === 'AREC') return 'ARC';
                    if (strD === 'WORKSHOP AR' || strD === 'WORKSHOP_AR' || strD === 'WKS AR' || strD === 'HMC') return 'WKS_AR';
                    if (strD === 'WORKSHOP PG' || strD === 'WORKSHOP_PG' || strD === 'WKS PG' || strD === 'WORKSHOP P.G' || strD === 'WORKSHOP P.G.' || strD === 'AMC') return 'WKS_PG';
                    if (strD === 'NURSERY') return 'NRS';
                    if (strD === 'INFRA') return 'INF';
                    return strD;
                });

                if (role === UserRole.ADMIN || role === UserRole.VISITOR || divisions.some(d => d.toUpperCase() === 'ALL')) {
                    divisions = AuthService.ALL_DIVISIONS;
                    if (role !== UserRole.VISITOR) role = UserRole.ADMIN;
                }

                return {
                    id: Number((payload as any).userId) || 0,
                    username: String(username),
                    email: (payload as any).email || "external@remote",
                    full_name: (payload as any).name || (payload as any).full_name || String(username),
                    role,
                    divisions: [...new Set(divisions)],
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date()
                };
            }

            // Normalize Role
            let roleStr = (payload as any).role || "user";
            if (typeof roleStr === "string") roleStr = roleStr.toLowerCase();

            let role = UserRole.USER;
            if (roleStr === "admin") role = UserRole.ADMIN;
            else if (roleStr === "kerani") role = UserRole.KERANI;
            else if (roleStr === "visitor") role = UserRole.VISITOR;

            // Try to find user locally
            const user = await this.getUser(username);

            if (user) {
                // console.log(`[AuthService] User '${username}' found locally.`);
                const { password_hash, ...safeUser } = user;
                // Normalize divisions for internal users too (AREC -> ARC, WORKSHOP AR -> WKS_AR, etc.)
                // This ensures consistency between internal and external tokens
                const originalDivisions = safeUser.divisions ? [...safeUser.divisions] : [];
                if (safeUser.divisions && Array.isArray(safeUser.divisions)) {
                    safeUser.divisions = safeUser.divisions.map(d => {
                        const strD = String(d).toUpperCase().trim();
                        if (strD === 'AREC') return 'ARC';
                        if (strD === 'WORKSHOP AR' || strD === 'WORKSHOP_AR' || strD === 'WKS AR' || strD === 'HMC') return 'WKS_AR';
                        if (strD === 'WORKSHOP PG' || strD === 'WORKSHOP_PG' || strD === 'WKS PG' || strD === 'WORKSHOP P.G' || strD === 'WORKSHOP P.G.' || strD === 'AMC') return 'WKS_PG';
                        if (strD === 'NURSERY') return 'NRS';
                        if (strD === 'INFRA') return 'INF';
                        return strD;
                    });
                    // Deduplicate
                    safeUser.divisions = [...new Set(safeUser.divisions)];
                    console.log(`[AuthService] Normalized divisions for user ${username}: ${JSON.stringify(originalDivisions)} -> ${JSON.stringify(safeUser.divisions)}`);
                }
                return safeUser;
            }

            // If not found locally, allow transient if External Token (RS256)
            // MODIFIED: Allow transient creation for ANY valid RS256 token, regardless of Config.AUTH_MODE
            // This enables hybrid mode where Internal server can still accept External tokens.
            if (header.alg === "RS256") {
                const externalId = (payload as any).userId || 0;

                // Extract divisions from various possible payload keys
                // PRIORITY: divisions > division > unit > location > loc_code
                let rawDivs = (payload as any).divisions ||
                    (payload as any).division ||
                    (payload as any).divisi ||
                    (payload as any).div ||
                    (payload as any).DIV ||
                    (payload as any).unit ||
                    (payload as any).kode_lokasi ||
                    (payload as any).location ||
                    (payload as any).loc_code ||
                    [];

                // Normalize to string array
                let divisions: string[] = [];
                if (Array.isArray(rawDivs)) {
                    divisions = rawDivs.map(d => String(d));
                } else if (typeof rawDivs === 'string') {
                    // Handle comma-separated or single value
                    if (rawDivs.includes(',')) {
                        divisions = rawDivs.split(',').map(d => d.trim());
                    } else if (rawDivs.trim() !== '') {
                        divisions = [rawDivs.trim()];
                    }
                }

                // FALLBACK FOR KERANI: If no divisions found in token, try to infer from username
                // Pattern: kerani_pg2a -> PG2A, kerani_wks_ar -> WKS_AR
                if (divisions.length === 0 && role === UserRole.KERANI) {
                    if (username.toLowerCase().startsWith('kerani_')) {
                        const inferredDiv = username.substring(7).toUpperCase();
                        // console.log(`[AuthService] Inferred division '${inferredDiv}' from username '${username}' for KERANI user.`);
                        divisions.push(inferredDiv);
                    } else {
                        const parts = username.split('_');
                        if (parts.length > 1) {
                            const inferredDiv = parts[1].toUpperCase();
                            // console.log(`[AuthService] Inferred division '${inferredDiv}' from username '${username}' for KERANI user.`);
                            divisions.push(inferredDiv);
                        }
                    }
                }

                // Logic to handle JSON stringified arrays (e.g. "[\"ARC\"]")
                // Check if the FIRST element looks like a JSON array string
                if (divisions.length === 1 && typeof divisions[0] === 'string') {
                    const first = divisions[0].trim();
                    if (first.startsWith("[") && first.endsWith("]")) {
                        try {
                            const parsed = JSON.parse(first);
                            if (Array.isArray(parsed)) {
                                divisions = parsed.map(d => String(d));
                            }
                        } catch (e) {
                            console.warn("[AuthService] Failed to parse stringified divisions array:", first);
                        }
                    }
                }

                if (divisions.length === 0) {
                    console.warn(`[AuthService] No divisions found in token for user ${username}. Payload keys: ${Object.keys(payload).join(", ")}`);
                    // USER REQUEST: Do NOT infer from username.
                }

                // CHECK FOR ADMIN / VISITOR / ALL ACCESS
                // If role is ADMIN or if divisions contains "ALL", grant full access
                // Note: If role is VISITOR, they get all divisions but DO NOT become ADMIN
                const currentRole = role as UserRole;
                const isAllDivisions = divisions.some(d => d.toUpperCase() === "ALL");
                const isAdmin = currentRole === UserRole.ADMIN || (isAllDivisions && roleStr !== "visitor");
                const isVisitor = roleStr === "visitor" || (isAllDivisions && roleStr === "visitor");

                if (isAdmin) {
                    role = UserRole.ADMIN;
                    divisions = AuthService.ALL_DIVISIONS;
                } else if (isVisitor) {
                    role = UserRole.VISITOR;
                    divisions = AuthService.ALL_DIVISIONS;
                } else {
                    // Normalize "AREC" to "ARC" and "WORKSHOP" aliases to fix external token mappings
                    divisions = divisions.map(d => {
                        const strD = String(d).toUpperCase().trim();
                        if (strD === 'AREC') return 'ARC';
                        if (strD === 'WORKSHOP AR' || strD === 'WORKSHOP_AR' || strD === 'WKS AR' || strD === 'HMC') return 'WKS_AR';
                        if (strD === 'WORKSHOP PG' || strD === 'WORKSHOP_PG' || strD === 'WKS PG' || strD === 'WORKSHOP P.G' || strD === 'WORKSHOP P.G.' || strD === 'AMC') return 'WKS_PG';
                        return strD;
                    });

                    // Deduplicate
                    divisions = [...new Set(divisions)];
                }

                console.log(`[AuthService] Creating transient user from external token. ID: ${externalId}, Role: ${role}`);
                console.log(`[AuthService] Transient Divisions extracted: ${JSON.stringify(divisions)}`);

                return {
                    id: externalId,
                    username: username,
                    email: (payload as any).email || "external@remote",
                    full_name: (payload as any).name || (payload as any).full_name || username,
                    role: role,
                    divisions: divisions,
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date()
                };
            }

            return null;
        } catch (e) {
            console.error("[AuthService] verifyToken exception:", e);
            return null;
        }
    }

    private logAudit(userId: number, action: string, details: string) {
        try {
            this.db.run(
                "INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)",
                [userId, action, details]
            );
        } catch (e) {
            console.error("[AuthService] Failed to log audit:", e);
        }
    }

    public getAccessibleDivisions(user: User): string[] {
        if (user.role === UserRole.ADMIN || user.role === UserRole.VISITOR) {
            return AuthService.ALL_DIVISIONS;
        }
        // For USER and KERANI, return assigned divisions
        return user.divisions;
    }

    public listUsers(skip: number = 0, limit: number = 100): User[] {
        const rows = this.db.query("SELECT * FROM users WHERE is_active = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, skip) as any[];
        return rows.map(row => {
            const mapped = this.mapRowToUser(row);
            const { password_hash, ...safeUser } = mapped;
            return safeUser;
        });
    }

    public async createUser(userData: { username: string; email: string; password: string; full_name: string; role?: string; divisions?: string[]; is_active?: boolean }): Promise<User> {
        const hash = bcrypt.hashSync(userData.password, 10);
        const divisions = JSON.stringify(userData.divisions || []);
        const role = userData.role || "user";
        const isActive = userData.is_active !== undefined ? userData.is_active : true;

        this.db.run(
            `INSERT INTO users (username, email, password_hash, full_name, role, divisions, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userData.username, userData.email, hash, userData.full_name, role, divisions, isActive]
        );

        const user = await this.getUser(userData.username);
        if (!user) throw new Error("Failed to create user");

        const { password_hash, ...safeUser } = user;
        return safeUser;
    }

    public deleteUser(userId: number): boolean {
        const result = this.db.run("UPDATE users SET is_active = 0 WHERE id = ?", [userId]);
        return (result.changes || 0) > 0;
    }
}
