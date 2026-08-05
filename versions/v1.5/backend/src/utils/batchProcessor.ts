import { debug, error as logError } from "./logger";

export interface BatchOptions<T, R> {
    items: T[];
    batchSize: number;
    processFn: (batch: T[], index: number) => Promise<R>;
    onBatchComplete?: (result: R, index: number, total: number) => void;
    label?: string;
}

/**
 * Generic batch processor to handle large arrays of items sequentially or in parallel.
 */
export async function processInBatches<T, R>(options: BatchOptions<T, R>): Promise<R[]> {
    const { items, batchSize, processFn, onBatchComplete, label = "BatchProcessor" } = options;
    const results: R[] = [];
    const totalBatches = Math.ceil(items.length / batchSize);

    debug(label, `Starting batch processing: ${items.length} items, ${totalBatches} batches (size: ${batchSize})`);

    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchIndex = Math.floor(i / batchSize);
        
        try {
            const result = await processFn(batch, batchIndex);
            results.push(result);
            
            if (onBatchComplete) {
                onBatchComplete(result, batchIndex, totalBatches);
            }
        } catch (err: any) {
            logError(label, `Error processing batch ${batchIndex}: ${err.message}`);
            throw err;
        }
    }

    return results;
}

/**
 * Parallel batch processor for high-throughput operations.
 */
export async function processInParallelBatches<T, R>(options: BatchOptions<T, R>): Promise<R[]> {
    const { items, batchSize, processFn, label = "ParallelBatchProcessor" } = options;
    const chunks: T[][] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
        chunks.push(items.slice(i, i + batchSize));
    }

    debug(label, `Starting parallel batch processing: ${items.length} items, ${chunks.length} chunks`);
    
    return await Promise.all(chunks.map((chunk, idx) => processFn(chunk, idx)));
}
