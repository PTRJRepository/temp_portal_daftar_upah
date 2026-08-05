import { Elysia, t } from "elysia";
import { AuthService } from "../services/authService";
import { User, UserRole } from "../types/user";
import { resolveUserFromHeaders } from "../utils/authBypass";

const authService = AuthService.getInstance();

// Helper to get current user from token
async function getUserFromHeader(headers: Record<string, string | undefined>): Promise<User | null> {
    return resolveUserFromHeaders(headers, authService);
}

export const usersRoutes = new Elysia({ prefix: "/users" })
    .derive(async ({ headers }) => {
        const user = await getUserFromHeader(headers);
        return { currentUser: user };
    })
    .get("/", async ({ currentUser, set, query }) => {
        if (!currentUser) {
            set.status = 401;
            return { message: "Unauthorized" };
        }
        if (currentUser.role !== UserRole.ADMIN) {
            set.status = 403;
            return { message: "Only admin can list users" };
        }

        const skip = parseInt(query.skip || "0");
        const limit = parseInt(query.limit || "100");

        // Get users from SQLite
        const users = await authService.listUsers(skip, limit);
        return users.map((u: any) => ({
            id: u.id,
            username: u.username,
            email: u.email,
            full_name: u.full_name,
            role: u.role,
            divisions: u.divisions,
            is_active: u.is_active,
            created_at: u.created_at,
            updated_at: u.updated_at
        }));
    }, {
        query: t.Object({
            skip: t.Optional(t.String()),
            limit: t.Optional(t.String())
        })
    })
    .get("/:user_id", async ({ params, currentUser, set }) => {
        if (!currentUser) {
            set.status = 401;
            return { message: "Unauthorized" };
        }
        const userId = parseInt(params.user_id);

        if (currentUser.role !== UserRole.ADMIN && currentUser.id !== userId) {
            set.status = 403;
            return { message: "Can only access own user information" };
        }

        const user = await authService.getUserById(userId);
        if (!user) {
            set.status = 404;
            return { message: "User not found" };
        }
        return user;
    })
    .post("/", async ({ body, currentUser, set }) => {
        if (!currentUser) {
            set.status = 401;
            return { message: "Unauthorized" };
        }
        if (currentUser.role !== UserRole.ADMIN) {
            set.status = 403;
            return { message: "Only admin can create users" };
        }

        try {
            const newUser = await authService.createUser(body as any);
            return newUser;
        } catch (e: any) {
            set.status = 400;
            return { message: e.message || "Failed to create user" };
        }
    }, {
        body: t.Object({
            username: t.String(),
            email: t.String(),
            password: t.String(),
            full_name: t.String(),
            role: t.Optional(t.String()),
            divisions: t.Optional(t.Array(t.String())),
            is_active: t.Optional(t.Boolean())
        })
    })
    .delete("/:user_id", async ({ params, currentUser, set }) => {
        if (!currentUser) {
            set.status = 401;
            return { message: "Unauthorized" };
        }
        if (currentUser.role !== UserRole.ADMIN) {
            set.status = 403;
            return { message: "Only admin can delete users" };
        }

        const userId = parseInt(params.user_id);
        if (currentUser.id === userId) {
            set.status = 400;
            return { message: "Cannot delete your own account" };
        }

        const success = await authService.deleteUser(userId);
        if (!success) {
            set.status = 404;
            return { message: "User not found" };
        }
        return { message: "User deleted successfully" };
    });
