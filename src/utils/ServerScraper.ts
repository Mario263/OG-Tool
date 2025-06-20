
import { ScrapingConfig, ScrapingResult } from './ScrapingEngine';

export class ServerScraper {
  static async scrapeWebsite(
    config: ScrapingConfig,
    onProgress?: (current: number, total: number, url: string) => void,
    onLog?: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void,
    onDataExtracted?: (data: any) => void
  ): Promise<ScrapingResult> {
    
    onLog?.('Starting server-side scraping...', 'info');
    onLog?.('Note: Using Supabase Edge Function for CORS-free scraping', 'info');

    try {
      const response = await fetch('/functions/v1/web-scraper', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY || ''}`,
        },
        body: JSON.stringify({ config }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error);
      }

      onLog?.(`Server-side scraping completed! Extracted ${result.items.length} items`, 'success');
      
      // Simulate progress updates for UI
      result.items.forEach((item: any, index: number) => {
        onProgress?.(index + 1, result.items.length, item.source_url);
        onDataExtracted?.(item);
      });

      return result;
    } catch (error) {
      onLog?.(`Server scraping failed: ${error}`, 'error');
      throw error;
    }
  }

  static isAvailable(): boolean {
    // Check if we have Supabase configuration
    return !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  }
}
