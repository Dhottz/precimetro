import { SefazResult } from './sefaz';

const SERVER_URL = process.env.EXPO_PUBLIC_SCRAPER_URL || '';
const API_KEY = process.env.EXPO_PUBLIC_SCRAPER_API_KEY || '';

export async function scrapeReceipt(qrUrl: string): Promise<SefazResult> {
  if (!SERVER_URL) throw new Error('Servidor não configurado');

  const response = await fetch(
    `${SERVER_URL}/scrape?url=${encodeURIComponent(qrUrl)}`,
    {
      headers: { 'x-api-key': API_KEY },
      signal: AbortSignal.timeout(40000), // 40s timeout
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || `Erro ${response.status} no servidor`);
  }

  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || 'Erro ao extrair nota');

  return payload.data as SefazResult;
}

export function scraperConfigured(): boolean {
  return !!SERVER_URL && SERVER_URL !== 'https://SEU-PROJETO.up.railway.app';
}
