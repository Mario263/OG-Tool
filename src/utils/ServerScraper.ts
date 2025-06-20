
import { supabase } from "@/integrations/supabase/client";
import { ScrapingConfig, ScrapingResult } from './ScrapingEngine';

export class ServerScraper {
  static async scrapeWebsite(
    config: ScrapingConfig,
    onProgress?: (current: number, total: number, url: string) => void,
    onLog?: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void,
    onDataExtracted?: (data: any) => void
  ): Promise<ScrapingResult> {
    
    onLog?.('Starting server-side scraping...', 'info');
    onLog?.('Using Supabase Edge Function for CORS-free scraping', 'info');

    try {
      // Use Supabase client to invoke the edge function
      const { data: result, error } = await supabase.functions.invoke('web-scraper', {
        body: { config }
      });

      if (error) {
        console.error('Edge function error:', error);
        throw new Error(`Server error: ${error.message}`);
      }

      if (!result) {
        throw new Error('No data returned from server');
      }

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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      onLog?.(`Server scraping failed: ${errorMessage}`, 'error');
      console.error('ServerScraper error:', error);
      throw error;
    }
  }

  static isAvailable(): boolean {
    // Check if Supabase client is properly configured
    try {
      // Simple check to see if supabase client exists and has the functions property
      return !!(supabase && supabase.functions);
    } catch (error) {
      console.error('Supabase availability check failed:', error);
      return false;
    }
  }
}
