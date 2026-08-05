import { Elysia } from "elysia";
import { Config } from "../config";
import { currentPeriodService } from "../services/currentPeriodService";

/**
 * Development mode info endpoint
 * Matches Python's /dev-mode endpoint
 */
export const devConfigRoutes = new Elysia()
    .get("/dev-mode", async () => {
        // Get current period from database
        const currentPeriod = await currentPeriodService.getCurrentPeriod();

        return {
            dev_mode: Config.isDev,
            run_mode: Config.RUN_MODE,
            auth_mode: Config.AUTH_MODE,
            use_proxy: Config.USE_PROXY,
            test_mode: Config.TEST_MODE,
            default_gang: Config.DEFAULT_GANG,
            default_month: Config.DEFAULT_MONTH,
            default_year: Config.DEFAULT_YEAR,
            current_period: {
                month: currentPeriod.month,
                year: currentPeriod.year,
                latest_trx_date: currentPeriod.latest_trx_date,
                latest_acc_month: currentPeriod.latest_acc_month,
                latest_acc_year: currentPeriod.latest_acc_year,
                is_cached: currentPeriod.is_cached
            },
            environment_vars: {
                TEST_MODE: Config.TEST_MODE,
                DEV_MODE: Config.isDev,
                DB_PROFILE: Config.DB_PROFILE,
                DB_DATABASE: Config.DEFAULT_DATABASE,
                DB_API_URL: Config.DB_API_URL,
                LOG_LEVEL: Config.LOG_LEVEL
            },
            constants: {
                upah_minimum_dasar: Config.UPAH_MINIMUM_DASAR,
                bpjs_gaji_pokok_min: Config.BPJS_GAJI_POKOK_MIN,
                iuran_spsi: Config.IURAN_SPSI
            }
        };
    })
    .get("/config", () => ({
        success: true,
        config: {
            run_mode: Config.RUN_MODE,
            auth_mode: Config.AUTH_MODE,
            use_proxy: Config.USE_PROXY,
            port: Config.PORT,
            host: Config.HOST
        }
    }));
