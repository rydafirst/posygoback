import { Inject, Injectable, Logger } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import type { KnowledgePack } from "../../shared";

const FRESH_MS = 10 * 60_000;
const EMPTY: KnowledgePack = { builtAt: new Date(0).toISOString(), pages: [], articles: [], faqs: [] };

export const KNOWLEDGE_FETCH = Symbol("KNOWLEDGE_FETCH");
export type KnowledgeFetch = (url: string) => Promise<KnowledgePack>;

export async function fetchKnowledge(url: string): Promise<KnowledgePack> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) {
    throw new Error(`Knowledge pack replied ${response.status}`);
  }
  const pack = (await response.json()) as Partial<KnowledgePack>;
  if (!Array.isArray(pack.pages) || !Array.isArray(pack.articles) || !Array.isArray(pack.faqs)) {
    throw new Error("Knowledge pack is malformed");
  }
  return pack as KnowledgePack;
}

@Injectable()
export class KnowledgePackService {
  private readonly logger = new Logger(KnowledgePackService.name);
  private pack: KnowledgePack = EMPTY;
  private loadedAt = 0;

  constructor(
    @Inject(KNOWLEDGE_FETCH) private readonly load: KnowledgeFetch,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async current(): Promise<KnowledgePack> {
    if (Date.now() - this.loadedAt < FRESH_MS) {
      return this.pack;
    }
    const url = this.config.ASSISTANT_KNOWLEDGE_URL || `${this.config.WEB_PUBLIC_URL.replace(/\/$/, "")}/assistant-knowledge.json`;
    try {
      this.pack = await this.load(url);
    } catch (error) {
      this.logger.warn(`Using the last knowledge pack: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.loadedAt = Date.now();
    return this.pack;
  }
}
