
import { Elysia, t } from "elysia";
import { TunjanganService } from "../services/tunjanganService";

export const tunjanganRoutes = new Elysia({ prefix: '/tunjangan' })
    .get('/rates', async ({ query }) => {
        try {
            const category = query.category || 'JABATAN';
            const rates = await TunjanganService.getRates(category);
            return { success: true, data: rates };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            category: t.Optional(t.String())
        })
    });
